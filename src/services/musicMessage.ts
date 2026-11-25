import type { Message } from 'node-karin'
import { segment } from 'node-karin'

import { Config } from '@/config'
import { formatArtists } from '@/music/providers/helpers'
import type { MusicItem, MusicPlayable, MusicSource } from '@/music/types'
import { buildMusicListCardHtml, logCardRenderFailure, renderCardImage } from '@/services/cardRender'
import { sendWithMediaRetry } from '@/services/mediaRetry'
import { sendMusicCard } from '@/services/musicCard'

import type { ReplyHelperOptions } from './message'

type ReplyPayload = Parameters<Message['reply']>[0]
type ReplyTextFn = (e: Message, text: string, options?: ReplyHelperOptions) => Promise<void>

/**
 * 出站本地音频要带 scheme：Milky 协议端（Yogurt）会拿裸路径去解 URI，
 * 直接抛 `Unsupported URI scheme: /app/...mp3`。NapCat 也能吃 file://，
 * 所以统一补前缀，不按协议分叉。
 */
const toRecordFile = (file: string) => {
  if (!file) return file
  if (/^(?:https?:|base64:|file:):?\/\//i.test(file)) return file
  if (/^base64:/i.test(file)) return file
  return `file://${file.replace(/\\/g, '/')}`
}

/**
 * 原生音乐卡平台映射.
 * 各平台适配器对不支持的 id 不抛错, 只渲染空卡, 所以必须在此按平台 id 形状过滤;
 * 无原生渠道（B站）或 id 形状不合法时返回 undefined, 调用方降级到自定义卡.
 */
export const nativeMusicCard = (source: MusicItem['source'], id: string) => {
  const cleanId = id?.trim()
  if (!cleanId) return undefined
  switch (source) {
    case 'netease':
      return /^\d+$/.test(cleanId) ? { platform: '163' as const, id: cleanId } : undefined
    case 'qq':
      return /^[0-9A-Za-z]{14}$/.test(cleanId) ? { platform: 'qq' as const, id: cleanId } : undefined
    case 'kuwo':
      return /^\d+$/.test(cleanId) ? { platform: 'kuwo' as const, id: cleanId } : undefined
    case 'kugou':
      // kugou 的 id 是 32 位音频 hash, 不是数字 id.
      return /^[0-9a-fA-F]{32}$/.test(cleanId) ? { platform: 'kugou' as const, id: cleanId } : undefined
    default:
      return undefined
  }
}

export const replyMusicPlayable = async (e: Message, playable: MusicPlayable) => {
  await sendMusicCard(e, playable)
}

export const replyVoiceFileOrAudio = async (e: Message, playable: MusicPlayable, voiceFile?: string) => {
  try {
    const result = await e.reply(segment.record(toRecordFile(voiceFile || playable.audioUrl)) as ReplyPayload)
    return result?.messageId
  } catch {
    if (voiceFile && voiceFile !== playable.audioUrl) {
      try {
        const result = await e.reply(segment.record(toRecordFile(playable.audioUrl)) as ReplyPayload)
        return result?.messageId
      } catch {
        // 直链也失败, 继续降级到音乐卡 + 文本链接, 保证不空回.
      }
    }
    await replyMusicPlayable(e, playable)
    return undefined
  }
}

const musicSourceLabel = (source?: MusicSource) => {
  switch (source) {
    case 'netease': return '网易云'
    case 'qq': return 'QQ音乐'
    case 'kuwo': return '酷我'
    case 'kugou': return '酷狗'
    case 'bilibili': return '哔哩哔哩'
    default: return undefined
  }
}

export const createReplyMusicList = (replyText: ReplyTextFn) => async (
  e: Message,
  items: MusicItem[],
  page: number,
  options?: {
    startIndex?: number
    keyword?: string
    source?: MusicSource
    ttlSeconds?: number
  }
) => {
  if (items.length === 0) {
    await replyText(e, '没有搜到相关歌曲')
    return undefined
  }

  const startIndex = Math.max(1, Math.floor(options?.startIndex ?? 1))
  const rows = items.map((item, offset) => {
    const duration = item.durationSeconds ? `${Math.floor(item.durationSeconds / 60)}:${String(item.durationSeconds % 60).padStart(2, '0')}` : ''
    return {
      index: startIndex + offset,
      title: item.title,
      artists: formatArtists(item.artists),
      duration,
      coverUrl: item.coverUrl,
      album: item.album,
      source: musicSourceLabel(item.source)
    }
  })

  const extractMessageId = (result: unknown) => {
    if (typeof result !== 'object' || result === null || !('messageId' in result)) return undefined
    const messageId: unknown = result.messageId
    return typeof messageId === 'string' && messageId ? messageId : undefined
  }

  try {
    const images = await renderCardImage({
      name: 'music-list',
      html: buildMusicListCardHtml(rows, page, startIndex, {
        keyword: options?.keyword,
        source: musicSourceLabel(options?.source ?? items[0]?.source),
        coverUrl: items.find(item => item.coverUrl)?.coverUrl,
        ttlSeconds: options?.ttlSeconds ?? Config.music.sessionTtlSeconds
      }),
      width: 920
    })
    const result = await sendWithMediaRetry(payload => e.reply(payload as ReplyPayload), images)
    return extractMessageId(result)
  } catch (error) {
    logCardRenderFailure('music-list', error)
    const lines = rows.map(row => `${row.index}. ${row.title} - ${row.artists}${row.duration ? ` ${row.duration}` : ''}`)
    const result = await e.reply([`---点歌列表[第${page}页]---`, ...lines, '----------------', '发送序号点歌，发送 #下一页 查看更多。'].join('\n') as ReplyPayload)
    return extractMessageId(result)
  }
}
