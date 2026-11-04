import type { Message } from 'node-karin'

import { formatArtists } from '@/music/providers/helpers'
import type { MusicPlayable } from '@/music/types'

/**
 * OIDB 0xb77_9 音乐卡片。
 *
 * 与 music 段 / 第三方 ark 的最大区别：这条路由插件自己拼 OIDB 包，经 NapCat 的
 * `send_packet` 直接发出去，协议端只负责传输，不做音乐卡片签名转换。
 * 因此它是可观测的（有 retcode），失败能重试、能熔断，也不会被 NapCat 静默丢元素。
 *
 * 凭据是 QQ 客户端内置的分享常量（mirai 的 MusicShare.kt 里也是同一组），
 * 不是任何第三方下发的 key；QQ 大版本改协议时跟上游更新即可。
 */
type OidbProfile = {
  appid: number
  appname: string
  appsign: string
}

const profiles: Record<string, OidbProfile> = {
  qq: { appid: 100497308, appname: 'com.tencent.qqmusic', appsign: 'cbd27cd7c861227d013a25b2d10f0799' },
  netease: { appid: 100495085, appname: 'com.netease.cloudmusic', appsign: 'da6b069da1e2982db3e386233f68d76d' },
  kuwo: { appid: 100243533, appname: 'cn.kuwo.player', appsign: 'bf9ff4ffb4c558a34ee3fd52c223ebf5' },
  kugou: { appid: 205141, appname: 'com.kugou.android', appsign: 'fe4a24d80fcf253a00676a808f62c2c6' },
  bilibili: { appid: 100951776, appname: 'tv.danmaku.bili', appsign: '7194d531cbe7960a22007b9f6bdaa38b' }
}

export const oidbSupportedSource = (source: string) => Boolean(profiles[source])

const encodeVarint = (value: number | bigint): Buffer => {
  let current = typeof value === 'bigint' ? value : BigInt(Math.max(0, Math.trunc(value)))
  const bytes: number[] = []
  while (current > 0x7fn) {
    bytes.push(Number(current & 0x7fn) | 0x80)
    current >>= 7n
  }
  bytes.push(Number(current))
  return Buffer.from(bytes)
}

const pbKey = (field: number, wire: number) => encodeVarint((BigInt(field) << 3n) | BigInt(wire))

const pbUint = (field: number, value: number | bigint) => Buffer.concat([pbKey(field, 0), encodeVarint(value)])

const pbString = (field: number, value: string | undefined) => {
  const bytes = Buffer.from(value ?? '', 'utf8')
  return Buffer.concat([pbKey(field, 2), encodeVarint(bytes.length), bytes])
}

const pbMessage = (field: number, parts: Buffer[]) => {
  const bytes = Buffer.concat(parts)
  return Buffer.concat([pbKey(field, 2), encodeVarint(bytes.length), bytes])
}

type OidbTarget = { sendType: number, peer: bigint }

const resolveTarget = (e: Message): OidbTarget => {
  const peer = String(e.contact?.peer ?? e.userId ?? '').replace(/\D/g, '')
  if (!peer) throw new Error('拿不到发送目标')
  return { sendType: e.isGroup ? 1 : 0, peer: BigInt(peer) }
}

export type OidbMusicOptions = {
  title: string
  singer: string
  jumpUrl: string
  preview: string
  musicUrl: string
  text?: string
}

export const buildOidbMusicPacket = (source: string, target: OidbTarget, options: OidbMusicOptions): Buffer => {
  const profile = profiles[source]
  if (!profile) throw new Error(`平台 ${source} 不支持 OIDB 卡片`)
  const musicUrl = options.musicUrl.trim()
  const hasAudio = musicUrl.length > 0

  const app = [
    pbUint(1, 1),
    pbString(2, '0.0.0'),
    pbString(3, profile.appname),
    pbString(4, profile.appsign)
  ]

  const music = [
    pbString(10, options.title),
    pbString(11, options.singer),
    pbString(12, options.text || `[分享]${options.title}-${options.singer}`),
    pbString(13, options.jumpUrl),
    pbString(14, options.preview),
    pbString(16, musicUrl)
  ]

  return Buffer.concat([
    pbUint(1, profile.appid),
    pbUint(2, 1),
    // 4 = 带音频的分享卡，0 = 只有跳转链接
    pbUint(3, hasAudio ? 4 : 0),
    pbMessage(5, app),
    pbString(6, ''),
    pbUint(10, target.sendType),
    pbUint(11, target.peer),
    pbMessage(12, music),
    pbUint(19, 0)
  ])
}

const readVarint = (buffer: Buffer, offset: number): [bigint, number] => {
  let result = 0n
  let shift = 0n
  let index = offset
  while (index < buffer.length) {
    const byte = buffer[index]!
    result |= BigInt(byte & 0x7f) << shift
    index += 1
    if ((byte & 0x80) === 0) return [result, index]
    shift += 7n
    if (shift > 70n) break
  }
  throw new Error('protobuf varint 不完整')
}

/** OIDB 响应里 field 3 是 retcode（小飞同样用它判定） */
const readOidbRetcode = (bytes: Buffer): number | undefined => {
  let index = 0
  while (index < bytes.length) {
    const [key, afterKey] = readVarint(bytes, index)
    index = afterKey
    const field = Number(key >> 3n)
    const wire = Number(key & 0x7n)
    if (wire === 0) {
      const [value, afterValue] = readVarint(bytes, index)
      index = afterValue
      if (field === 3) return Number(value)
    } else if (wire === 2) {
      const [length, afterLength] = readVarint(bytes, index)
      index = afterLength + Number(length)
    } else if (wire === 5) {
      index += 4
    } else if (wire === 1) {
      index += 8
    } else {
      return undefined
    }
  }
  return undefined
}

type SendPacketResult = { result?: string, data?: string, retcode?: number }

const sendPacket = async (e: Message, cmd: string, data: Buffer) => {
  const bot = e.bot as unknown as {
    sendApi?: (action: string, params: Record<string, unknown>) => Promise<unknown>
  }
  if (typeof bot.sendApi !== 'function') throw new Error('当前协议端不支持 send_packet')

  const response = await bot.sendApi('send_packet', { cmd, data: data.toString('hex'), rsp: true })
  const payload = (typeof response === 'string' ? response : (response as SendPacketResult | undefined)?.result
    ?? (response as SendPacketResult | undefined)?.data) as string | undefined

  if (!payload) return
  let bytes: Buffer
  try {
    bytes = Buffer.from(payload, 'hex')
  } catch {
    return
  }
  if (bytes.length === 0) return
  const retcode = readOidbRetcode(bytes)
  if (retcode !== undefined && retcode !== 0) throw new Error(`OIDB 返回 retcode=${retcode}`)
}

/** 发送 OIDB 音乐卡片；失败抛错，交给通道链降级 */
export const sendOidbMusicCard = async (e: Message, playable: MusicPlayable) => {
  if (!playable.audioUrl) throw new Error('缺少音频直链')
  const target = resolveTarget(e)
  const packet = buildOidbMusicPacket(playable.item.source, target, {
    title: playable.item.title,
    singer: formatArtists(playable.item.artists),
    jumpUrl: playable.item.pageUrl,
    preview: playable.item.coverUrl || '',
    musicUrl: playable.audioUrl
  })
  await sendPacket(e, 'OidbSvc.0xb77_9', packet)
}
