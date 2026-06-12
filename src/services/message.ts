import * as fs from 'node:fs'
import { randomBytes } from 'node:crypto'
import path from 'node:path'

import type { Message } from 'node-karin'
import { common, segment } from 'node-karin'

import { Config } from '@/config'
import { formatArtists } from '@/music/providers/helpers'
import type { MusicItem, MusicPlayable } from '@/music/types'
import type { ResolvedPost, ResolverFailure, ResolverResult } from '@/resolvers/types'
import { buildMusicListCardHtml, logCardRenderFailure, renderCardImage } from '@/services/cardRender'

type ReplyPayload = Parameters<Message['reply']>[0]

const videoMessageLimitBytes = 100 * 1024 * 1024
const videoSendSaltBytes = 8
const resolverLongTextLength = 400
const prefix = () => Config.app.replyPrefix

const filenameFromPath = (file: string) => path.posix.basename(file.replace(/\\/g, '/')) || 'video.mp4'

const toVideoMessageFile = (file: string) => {
  if (/^(?:https?:|base64:|file:)/i.test(file)) return file
  return `file://${file.replace(/\\/g, '/')}`
}

const formatFileSize = (bytes: number) => {
  const mb = bytes / 1024 / 1024
  return `${mb >= 10 ? Math.round(mb) : Number(mb.toFixed(1))}MB`
}

const getLocalFileSize = (file: string) => {
  try {
    if (!fs.existsSync(file)) return undefined
    const stats = fs.statSync(file)
    if (typeof stats.isFile === 'function' && !stats.isFile()) return undefined
    return stats.size
  } catch {
    return undefined
  }
}

const createUniqueVideoCopy = (file: string, size?: number) => {
  if (!size || size + videoSendSaltBytes > videoMessageLimitBytes) return file

  try {
    const parsed = path.parse(file)
    const ext = parsed.ext || '.mp4'
    const output = path.join(parsed.dir, `${parsed.name}.send-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`)
    fs.copyFileSync(file, output)
    fs.appendFileSync(output, randomBytes(videoSendSaltBytes))
    return output
  } catch {
    return file
  }
}

const errorText = (error: unknown): string => {
  const parts: string[] = []
  let current: unknown = error
  for (let i = 0; i < 4 && current; i++) {
    if (current instanceof Error) {
      parts.push(current.message)
      current = current.cause
      continue
    }

    if (typeof current === 'object') {
      try {
        parts.push(JSON.stringify(current))
      } catch {
        parts.push(String(current))
      }
      break
    }

    parts.push(String(current))
    break
  }
  return parts.join('\n')
}

const isVideoTooLargeError = (error: unknown) => /video file too large|upload_group_file|upload_private_file/i.test(errorText(error))

const canUploadFile = (e: Message) => ['group', 'friend'].includes(e.contact.scene) && typeof e.bot.uploadFile === 'function'

const uploadVideoFile = async (e: Message, file: string, size?: number) => {
  if (!canUploadFile(e)) {
    await replyText(e, size
      ? `视频文件 ${formatFileSize(size)}，超过 100MB，当前场景无法作为视频消息发送。`
      : '视频文件超过 100MB，当前场景无法作为视频消息发送。')
    return
  }

  await replyText(e, size
    ? `视频文件 ${formatFileSize(size)}，超过 100MB，改为上传群文件。`
    : '视频文件超过 100MB，改为上传群文件。')
  try {
    await e.bot.uploadFile(e.contact, file, filenameFromPath(file))
  } catch (error) {
    await replyText(e, `上传群文件失败：${errorText(error) || '未知错误'}\n可以调低 B站下载画质或缩短下载上限后重试。`)
  }
}

const replyVideo = async (e: Message, file: string) => {
  const size = getLocalFileSize(file)
  if (size && size > videoMessageLimitBytes) {
    await uploadVideoFile(e, file, size)
    return
  }

  try {
    await e.reply(segment.video(toVideoMessageFile(createUniqueVideoCopy(file, size))) as ReplyPayload)
  } catch (error) {
    if (isVideoTooLargeError(error)) {
      await uploadVideoFile(e, file, size)
      return
    }
    await replyText(e, `视频发送失败：${error instanceof Error ? error.message : String(error)}`)
  }
}

export const replyText = async (e: Message, text: string) => {
  await e.reply(`${prefix()}：${text}` as ReplyPayload)
}

export const replyPlainText = async (e: Message, text: string) => {
  await e.reply(text as ReplyPayload)
}

export const replyImage = async (e: Message, url: string, title?: string) => {
  const elements = [
    title ? segment.text(`${prefix()}：${title}`) : undefined,
    segment.image(url)
  ].filter(Boolean)

  try {
    await e.reply(elements as ReplyPayload)
  } catch {
    await replyText(e, `${title ? `${title}\n` : ''}${url}`)
  }
}

export const replyMusicList = async (e: Message, items: MusicItem[], page: number) => {
  if (items.length === 0) {
    await replyText(e, '没有搜到相关歌曲')
    return
  }

  const rows = items.map(item => {
    const duration = item.durationSeconds ? `${Math.floor(item.durationSeconds / 60)}:${String(item.durationSeconds % 60).padStart(2, '0')}` : ''
    return {
      title: item.title,
      artists: formatArtists(item.artists),
      duration
    }
  })

  try {
    const images = await renderCardImage({
      name: 'music-list',
      html: buildMusicListCardHtml(rows, page),
      width: 920
    })
    await e.reply(images as ReplyPayload)
    return
  } catch (error) {
    logCardRenderFailure('music-list', error)
    const lines = rows.map((item, index) => `${index + 1}. ${item.title} - ${item.artists}${item.duration ? ` ${item.duration}` : ''}`)
    await replyPlainText(e, [`---点歌列表[第${page}页]---`, ...lines, '----------------', '发送序号点歌，发送 #下一页 查看更多。'].join('\n'))
  }
}

export const replyMusicPlayable = async (e: Message, playable: MusicPlayable) => {
  const { item } = playable
  const artists = formatArtists(item.artists)
  const elements = [
    item.coverUrl ? segment.image(item.coverUrl) : undefined,
    segment.customMusic(item.pageUrl, playable.audioUrl, item.title, artists, item.coverUrl || ''),
    segment.text(`${item.title} - ${artists}\n${item.pageUrl}`)
  ].filter(Boolean)

  try {
    await e.reply(elements as ReplyPayload)
  } catch {
    await e.reply(`${prefix()}：${item.title} - ${artists}\n${playable.audioUrl || item.pageUrl}` as ReplyPayload)
  }
}

export const replyVoiceOrAudio = async (e: Message, playable: MusicPlayable) => {
  try {
    await e.reply(segment.record(playable.audioUrl) as ReplyPayload)
  } catch {
    await replyMusicPlayable(e, playable)
  }
}

export const replyVoiceFileOrAudio = async (e: Message, playable: MusicPlayable, voiceFile?: string) => {
  try {
    await e.reply(segment.record(voiceFile || playable.audioUrl) as ReplyPayload)
  } catch {
    await replyMusicPlayable(e, playable)
  }
}

const isFailure = (result: ResolverResult): result is ResolverFailure => 'ok' in result && result.ok === false

const botForwardIdentity = (e: Message, fallbackName: string) => {
  const bot = e.bot as unknown as { account?: { selfId?: string | number, name?: string } }
  return {
    id: String(bot.account?.selfId || e.selfId || ''),
    name: fallbackName
  }
}

const canSendForward = (e: Message) => typeof (e.bot as unknown as { sendForwardMsg?: unknown }).sendForwardMsg === 'function'

const resolvedPostText = (post: ResolvedPost) => {
  const title = post.title ? `，${post.title}` : ''
  return `识别：${post.displayName}${title}${post.description ? `\n${post.description}` : ''}${post.pageUrl ? `\n${post.pageUrl}` : ''}`
}

const directResolvedPost = async (e: Message, post: ResolvedPost, text: string) => {
  const elements = [
    segment.text(text),
    ...post.images.slice(0, 9).map(url => segment.image(url))
  ]
  await e.reply(elements as ReplyPayload)
}

const replyResolvedPostForward = async (e: Message, post: ResolvedPost, text: string) => {
  const identity = botForwardIdentity(e, `${post.displayName}解析`)
  const nodes = common.makeForward([
    segment.text(text),
    ...post.images.map(url => segment.image(url))
  ], identity.id, identity.name)
  const isLongText = (post.description?.length || 0) > resolverLongTextLength
  const summary = post.images.length > 1
    ? `查看${post.images.length}张图片`
    : isLongText
      ? '查看完整解析内容'
      : '查看解析内容'

  await e.bot.sendForwardMsg(e.contact, nodes, {
    source: '解析结果',
    summary,
    prompt: `${post.displayName}解析结果`,
    news: [{ text: '点击查看解析结果' }]
  })
}

export const replyResolvedPost = async (e: Message, result: ResolverResult) => {
  if (isFailure(result)) {
    await replyPlainText(e, `${result.displayName}解析失败：${result.reason}`)
    return
  }

  const post = result as ResolvedPost
  const text = resolvedPostText(post)
  const shouldForward = post.images.length > 1 || (post.description?.length || 0) > resolverLongTextLength

  if (shouldForward && canSendForward(e)) {
    try {
      await replyResolvedPostForward(e, post, text)
    } catch {
      await directResolvedPost(e, post, text)
    }
  } else {
    await directResolvedPost(e, post, text)
  }

  const video = post.videos[0]
  if (video) await replyVideo(e, video)
}
