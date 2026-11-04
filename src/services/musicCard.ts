import type { Message } from 'node-karin'
import { logger, segment } from 'node-karin'

import { Config } from '@/config'
import { formatArtists } from '@/music/providers/helpers'
import type { MusicItem, MusicPlayable } from '@/music/types'
import type { MusicCardConfig } from '@/types/config'
import { fetchJson } from '@/services/http'
import { oidbSupportedSource, sendOidbMusicCard } from '@/services/musicOidb'

type ReplyPayload = Parameters<Message['reply']>[0]
type MusicCardChannel = 'platform' | 'oidb' | 'ark' | 'music'

type ChannelStats = { ok: number, fail: number, skip: number }
type BreakerState = { failures: number, blockedUntil: number, lastCause?: string }
type RecentRecord = { at: number, channel: MusicCardChannel, ok: boolean, ms: number, title: string, cause?: string }

const cardChannels: MusicCardChannel[] = ['platform', 'oidb', 'ark', 'music']
const arkRequiredFields = ['app', 'meta', 'prompt', 'view']
const recentLimit = 20
const causeLimit = 120
const arkMaxBytes = 256 * 1024

const breakers = new Map<MusicCardChannel, BreakerState>()
const stats: Record<MusicCardChannel, ChannelStats> = {
  platform: { ok: 0, fail: 0, skip: 0 },
  oidb: { ok: 0, fail: 0, skip: 0 },
  ark: { ok: 0, fail: 0, skip: 0 },
  music: { ok: 0, fail: 0, skip: 0 }
}
const recent: RecentRecord[] = []

const now = () => Date.now()
/**
 * `Config.music.card` 是 getter，每次访问都会重读 YAML（fs 读 + parse + merge）。
 * 一次点歌要判断多个通道，所以入口快照一次往下传，别再各读各的。
 */
const cardConfig = (): MusicCardConfig => Config.music.card
const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error))
const trimCause = (cause: string) => cause.replace(/\s+/g, ' ').trim().slice(0, causeLimit)
const isCardChannel = (value: unknown): value is MusicCardChannel => cardChannels.includes(String(value) as MusicCardChannel)

/** 配置里的通道顺序，非法或为空时回落成只走 music */
export const cardChannelOrder = (card: MusicCardConfig = cardConfig()): MusicCardChannel[] => {
  const configured = card.channels
  const order = (Array.isArray(configured) ? configured : []).filter(isCardChannel)
  return order.length ? order : ['music']
}

/**
 * 熔断只作用于可观测通道（oidb / ark）：它们有明确回执，连续失败说明上游确实坏了。
 * platform / music 是哑通道，协议端静默丢弃元素时插件无从感知，只记失败计数、不参与熔断。
 */
const observableChannels = new Set<MusicCardChannel>(['oidb', 'ark'])

const breakerState = (channel: MusicCardChannel): BreakerState => {
  const current = breakers.get(channel)
  if (current) return current
  const created: BreakerState = { failures: 0, blockedUntil: 0 }
  breakers.set(channel, created)
  return created
}

export const channelBlocked = (channel: MusicCardChannel, card: MusicCardConfig = cardConfig()) => {
  if (!observableChannels.has(channel)) return false
  const state = breakerState(channel)
  const { failThreshold, cooldownSeconds } = card.breaker
  if (state.failures < Math.max(1, failThreshold)) return false
  if (now() < state.blockedUntil) return true
  // 冷却结束，自动恢复
  state.failures = 0
  state.blockedUntil = 0
  state.lastCause = undefined
  logger.info(`[Hira-卡片] 通道=${channel} 熔断冷却结束，恢复尝试`)
  return false
}

const pushRecent = (record: RecentRecord) => {
  recent.unshift(record)
  if (recent.length > recentLimit) recent.length = recentLimit
}

const recordSuccess = (channel: MusicCardChannel, ms: number, title: string) => {
  const state = breakerState(channel)
  state.failures = 0
  state.blockedUntil = 0
  state.lastCause = undefined
  stats[channel].ok += 1
  pushRecent({ at: now(), channel, ok: true, ms, title })
  logger.info(`[Hira-卡片] 通道=${channel} 结果=ok 耗时=${ms}ms 曲目=${title}`)
}

const recordFailure = (channel: MusicCardChannel, cause: string, ms: number, title: string, card: MusicCardConfig) => {
  const trimmed = trimCause(cause)
  stats[channel].fail += 1
  pushRecent({ at: now(), channel, ok: false, ms, title, cause: trimmed })
  logger.warn(`[Hira-卡片] 通道=${channel} 结果=fail 耗时=${ms}ms 曲目=${title} cause=${trimmed}`)

  if (!observableChannels.has(channel)) return
  const state = breakerState(channel)
  state.failures += 1
  state.lastCause = trimmed
  const { failThreshold, cooldownSeconds } = card.breaker
  if (state.failures >= Math.max(1, failThreshold)) {
    state.blockedUntil = now() + Math.max(10, cooldownSeconds) * 1000
    logger.warn(`[Hira-卡片] 通道=${channel} 连续失败 ${state.failures} 次，熔断 ${cooldownSeconds}s`)
  }
}

const recordSkip = (channel: MusicCardChannel, title: string, reason: string, log = true) => {
  stats[channel].skip += 1
  if (log) logger.info(`[Hira-卡片] 通道=${channel} 结果=skip 曲目=${title} 原因=${reason}`)
}

const musicText = (playable: MusicPlayable) => {
  const artists = formatArtists(playable.item.artists)
  return `${playable.item.title} - ${artists}\n${playable.item.pageUrl}`
}

const arkFormat = (source: MusicItem['source'], card: MusicCardConfig) => {
  const value = card.ark.formats[source]
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

const platformType = (source: MusicItem['source'], card: MusicCardConfig) => {
  const value = card.platform.types[source]
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

const platformSkipReason = (playable: MusicPlayable, card: MusicCardConfig) => {
  if (!card.platform.enabled) return '通道已关闭'
  if (!platformType(playable.item.source, card)) return `平台 ${playable.item.source} 无标准卡片 ID`
  if (!String(playable.item.id ?? '').trim()) return '缺少歌曲 ID'
  return undefined
}

/** 纯数字 ID 转成数字，其余保持字符串（协议端两种都收） */
const toPlatformId = (id: string) => (/^\d+$/.test(id) ? Number(id) : id)

const arkSkipReason = (playable: MusicPlayable, card: MusicCardConfig) => {
  if (!card.ark.key.trim()) return '未配置 key'
  if (!arkFormat(playable.item.source, card)) return `平台 ${playable.item.source} 未配置 format`
  if (!playable.audioUrl) return '缺少音频直链'
  if (!playable.item.coverUrl) return '缺少封面'
  if (channelBlocked('ark', card)) return '熔断中'
  return undefined
}

const oidbSkipReason = (playable: MusicPlayable, card: MusicCardConfig) => {
  if (card.oidb?.enabled === false) return '通道已关闭'
  if (!oidbSupportedSource(playable.item.source)) return `平台 ${playable.item.source} 不支持 OIDB 卡片`
  if (!playable.audioUrl) return '缺少音频直链'
  if (channelBlocked('oidb', card)) return '熔断中'
  return undefined
}

const isArkCard = (value: unknown): value is Record<string, unknown> => (
  Boolean(value) &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  arkRequiredFields.every(field => field in (value as Record<string, unknown>))
)

const requestArkCard = async (playable: MusicPlayable, card: MusicCardConfig) => {
  const ark = card.ark
  const format = arkFormat(playable.item.source, card)
  if (!format) throw new Error(`平台 ${playable.item.source} 未配置签名 format`)

  const url = new URL(ark.apiUrl)
  url.searchParams.set('key', ark.key.trim())
  url.searchParams.set('url', playable.audioUrl)
  url.searchParams.set('song', playable.item.title)
  url.searchParams.set('singer', formatArtists(playable.item.artists))
  url.searchParams.set('cover', playable.item.coverUrl || '')
  url.searchParams.set('jump', playable.item.pageUrl)
  url.searchParams.set('format', format)

  const attempts = Math.max(0, Math.floor(ark.retries)) + 1
  let lastError: unknown
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const payload = await fetchJson<{ code?: number, data?: unknown }>(url.toString(), {
        timeoutMs: Math.max(1000, ark.timeoutMs),
        maxBytes: arkMaxBytes
      })
      if (payload?.code !== 200) throw new Error(`签名服务返回 code=${payload?.code ?? 'none'}`)
      if (!isArkCard(payload.data)) throw new Error('签名服务返回的卡片结构不完整')
      return payload.data
    } catch (error) {
      lastError = error
      if (attempt < attempts) {
        logger.warn(`[Hira-卡片] 通道=ark 第 ${attempt} 次请求失败，重试：${trimCause(errorMessage(error))}`)
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error(errorMessage(lastError))
}

/** ark 通道：第三方签名服务换回签好的 ark，用 json 段原样发出（协议端不再签名） */
const sendArkCard = async (e: Message, playable: MusicPlayable, card: MusicCardConfig) => {
  const arkCard = await requestArkCard(playable, card)
  const elements: unknown[] = []
  if (card.ark.attachCover && playable.item.coverUrl) elements.push(segment.image(playable.item.coverUrl))
  elements.push(segment.json(JSON.stringify(arkCard)))
  if (card.textFallback) elements.push(segment.text(musicText(playable)))
  await e.reply(elements as ReplyPayload)
}

/** platform 通道：标准平台卡片，身份由平台决定（网易云就是网易云），签名由协议端完成 */
const sendPlatformCard = async (e: Message, playable: MusicPlayable, card: MusicCardConfig) => {
  const type = platformType(playable.item.source, card)
  if (!type) throw new Error(`平台 ${playable.item.source} 无标准卡片 ID`)
  // 协议端只认这几个平台名，配置层已做校验，这里按协议端的类型收窄
  const platform = type as 'qq' | '163' | 'kugou' | 'kuwo' | 'migu'
  // Karin 的类型把 id 写成 string，但协议端两种都收；数字 ID 保持数字（签名服务实测认数字）
  const id = toPlatformId(String(playable.item.id ?? '').trim()) as string
  const elements: unknown[] = [segment.music(platform, id)]
  if (card.textFallback) elements.push(segment.text(musicText(playable)))
  await e.reply(elements as ReplyPayload)
}

/** music 通道：标准 music 段，签名由协议端内置服务完成（失败时静默丢元素） */
const sendMusicSegment = async (e: Message, playable: MusicPlayable, card: MusicCardConfig) => {
  const { item } = playable
  const artists = formatArtists(item.artists)
  const elements = [
    item.coverUrl ? segment.image(item.coverUrl) : undefined,
    segment.customMusic(item.pageUrl, playable.audioUrl, item.title, artists, item.coverUrl || ''),
    card.textFallback ? segment.text(musicText(playable)) : undefined
  ].filter(Boolean)
  await e.reply(elements as ReplyPayload)
}

export const sendMusicCard = async (e: Message, playable: MusicPlayable) => {
  const card = cardConfig()
  const title = playable.item.title
  const failures: string[] = []

  for (const channel of cardChannelOrder(card)) {
    if (channel === 'music' && !card.music.enabled) {
      recordSkip('music', title, '通道已关闭')
      continue
    }

    if (channel === 'platform') {
      const reason = platformSkipReason(playable, card)
      if (reason) {
        // 「平台无标准卡片 ID」是静态配置决定，不必每条都刷日志
        recordSkip('platform', title, reason, reason !== '通道已关闭' && !reason.endsWith('无标准卡片 ID'))
        continue
      }
    }

    if (channel === 'ark') {
      const reason = arkSkipReason(playable, card)
      if (reason) {
        // key 未配置是默认状态，不必每条都刷日志
        recordSkip('ark', title, reason, reason !== '未配置 key')
        continue
      }
    }

    if (channel === 'oidb') {
      const reason = oidbSkipReason(playable, card)
      if (reason) {
        // 「平台不支持 OIDB」是静态能力决定，不必每条都刷日志
        recordSkip('oidb', title, reason, reason !== '通道已关闭' && !reason.endsWith('不支持 OIDB 卡片'))
        continue
      }
    }

    const start = now()
    try {
      if (channel === 'platform') await sendPlatformCard(e, playable, card)
      else if (channel === 'oidb') await sendOidbMusicCard(e, playable)
      else if (channel === 'ark') await sendArkCard(e, playable, card)
      else await sendMusicSegment(e, playable, card)
      recordSuccess(channel, now() - start, title)
      return
    } catch (error) {
      const cause = errorMessage(error)
      failures.push(`${channel}: ${trimCause(cause)}`)
      recordFailure(channel, cause, now() - start, title, card)
    }
  }

  // 全通道失败也必须给用户一个回应，否则这条命令等于石沉大海
  logger.warn(`[Hira-卡片] 全部通道失败 曲目=${title} 详情=${failures.join(' | ') || '无可用通道'}`)
  await e.reply(musicText(playable) as ReplyPayload)
}

export const cardStatusSnapshot = () => {
  const card = cardConfig()
  const ark = breakerState('ark')
  const oidb = breakerState('oidb')
  return {
    order: cardChannelOrder(card),
    textFallback: card.textFallback,
    platformEnabled: card.platform.enabled,
    platformTypes: card.platform.types,
    musicEnabled: card.music.enabled,
    arkConfigured: Boolean(card.ark.key.trim()),
    arkApiUrl: card.ark.apiUrl,
    arkBlocked: channelBlocked('ark', card),
    arkFailures: ark.failures,
    arkLastCause: ark.lastCause,
    oidbEnabled: card.oidb?.enabled !== false,
    oidbBlocked: channelBlocked('oidb', card),
    oidbFailures: oidb.failures,
    oidbLastCause: oidb.lastCause,
    breaker: card.breaker,
    stats,
    recent
  }
}
