import * as fs from 'node:fs'
import path from 'node:path'

import type { CustomNodeElement, Message } from 'node-karin'
import { logger, segment } from 'node-karin'

import { Config } from '@/config'
import { formatArtists } from '@/music/providers/helpers'
import { dedupeImageUrls, imageQuality, isUsableImageUrl } from '@/resolvers/media'
import type { MusicItem, MusicPlayable } from '@/music/types'
import type { ResolvedPost, ResolverFailure, ResolverResult, ResolverVideo } from '@/resolvers/types'
import { downloadFile } from '@/runtime/downloader'
import { runFfmpeg } from '@/runtime/ffmpeg'
import { createTempFilePath } from '@/runtime/temp'
import {
  buildErrorCardHtml,
  buildMusicListCardHtml,
  buildResolverCardHtml,
  buildResolverPreviewCardHtml,
  logCardRenderFailure,
  renderCardImage
} from '@/services/cardRender'
import { sendWithMediaRetry } from '@/services/mediaRetry'
import { sendMusicCard } from '@/services/musicCard'
import { inlinePreviewCover } from '@/services/previewCover'
import {
  buildFakeForwardNode,
  buildResolverCommentNodes,
  buildResolverContentNodes,
  canSendResolverForward,
  resolverForwardCopy,
  resolveEventForwardIdentity,
  sendResolverForward
} from '@/services/resolverForward'

type ReplyPayload = Parameters<Message['reply']>[0]

const videoMessageLimitBytes = 100 * 1024 * 1024
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

const replyVideo = async (e: Message, file: string, pageUrl?: string) => {
  const size = getLocalFileSize(file)
  if (size && size > videoMessageLimitBytes) {
    await uploadVideoFile(e, file, size)
    return
  }

  try {
    await e.reply(segment.video(toVideoMessageFile(file)) as ReplyPayload)
  } catch (error) {
    if (isVideoTooLargeError(error)) {
      await uploadVideoFile(e, file, size)
      return
    }
    if (Config.resolver.sending.videoFailureFallbackEnabled !== false) {
      await replyText(e, `视频发送失败：${error instanceof Error ? error.message : String(error)}${pageUrl ? `\n原链接：${pageUrl}` : ''}`)
    }
  }
}

const isRemoteMedia = (url: string) => /^https?:\/\//i.test(url)

/**
 * CDN 直链需要平台页面作为 Referer; B站/抖音按完整页面 URL, 其余用页面源站.
 */
const videoReferer = (post: ResolvedPost) => {
  const pageUrl = post.pageUrl?.trim()
  if (pageUrl) {
    try {
      const parsed = new URL(pageUrl)
      return post.platform === 'bilibili' || post.platform === 'douyin'
        ? pageUrl
        : `${parsed.protocol}//${parsed.host}/`
    } catch {
      // 页面 URL 不合法时退回平台默认 Referer.
    }
  }
  const defaults: Partial<Record<ResolvedPost['platform'], string>> = {
    bilibili: 'https://www.bilibili.com/',
    douyin: 'https://www.douyin.com/',
    xiaohongshu: 'https://www.xiaohongshu.com/',
    weibo: 'https://weibo.com/',
    kuaishou: 'https://www.kuaishou.com/',
    tieba: 'https://tieba.baidu.com/',
    xiaoheihe: 'https://www.xiaoheihe.cn/'
  }
  return defaults[post.platform]
}

const videoExtension = (url: string) => {
  try {
    const ext = path.posix.extname(new URL(url).pathname).replace(/^\./, '').toLowerCase()
    return /^(?:mp4|m4v|mov|webm|flv|mkv|m4s)$/.test(ext) ? ext : 'mp4'
  } catch {
    return 'mp4'
  }
}

/**
 * resolve 阶段只登记直链, 真正的下载/合并/转封装留到发送时按需执行,
 * 避免解析阶段长时间阻塞首条回复, 也避免用户没等到结果却已下载大文件.
 */
const downloadResolverMedia = async (url: string, ext: string, referer?: string) => {
  const output = createTempFilePath('video', ext)
  await downloadFile({
    url,
    output,
    headers: {
      ...(referer ? { Referer: referer } : {}),
      Accept: '*/*'
    },
    timeoutMs: Math.max(5, Config.runtime.downloadTimeoutSeconds) * 1000,
    maxBytes: Config.runtime.maxVideoFileSizeBytes,
    proxy: Config.resolver.proxy || undefined
  })
  return output
}

const tryFfmpeg = async (options: Parameters<typeof runFfmpeg>[0]) => {
  try {
    return await runFfmpeg(options)
  } catch (error) {
    logger.warn(`[hira] ffmpeg ${options.format} failed: ${error instanceof Error ? error.message : String(error)}`)
    return undefined
  }
}

/**
 * 发送时准备视频: 远程直链先下载(沿用 runtime 体积上限), 有独立音轨则合并,
 * 再按需做 QQ 兼容转封装; 本地视频保持原样, 不重复转码.
 */
export const prepareResolverVideo = async (video: ResolverVideo, options?: { referer?: string }): Promise<string | undefined> => {
  const sourceUrl = video.url?.trim()
  if (!sourceUrl) return undefined
  const audioUrl = video.audioUrl?.trim()
  const remote = isRemoteMedia(sourceUrl)

  if (!remote) {
    if (!audioUrl) return sourceUrl
    const audioFile = isRemoteMedia(audioUrl)
      ? await downloadResolverMedia(audioUrl, 'm4a', options?.referer)
      : audioUrl
    const merged = await tryFfmpeg({
      format: 'merge',
      videoInput: sourceUrl,
      audioInput: audioFile,
      output: createTempFilePath('video', 'mp4')
    })
    return merged || sourceUrl
  }

  let videoFile = await downloadResolverMedia(sourceUrl, videoExtension(sourceUrl), options?.referer)
  if (audioUrl) {
    const audioFile = isRemoteMedia(audioUrl)
      ? await downloadResolverMedia(audioUrl, 'm4a', options?.referer)
      : audioUrl
    const merged = await tryFfmpeg({
      format: 'merge',
      videoInput: videoFile,
      audioInput: audioFile,
      output: createTempFilePath('video', 'mp4')
    })
    if (merged) videoFile = merged
  }

  const remuxed = await tryFfmpeg({
    format: 'qq-video',
    input: videoFile,
    output: createTempFilePath('video', 'mp4')
  })
  return remuxed || videoFile
}

const replyResolverVideo = async (e: Message, video: ResolverVideo, pageUrl?: string, referer?: string) => {
  if (isRemoteMedia(video.url)) {
    // 首条媒体下载前给临时占位, 到期自动撤回; 失败不影响后续发送.
    await replyText(e, '视频下载中，请稍候…', { recallMsg: 30 }).catch(() => undefined)
  }

  let file: string | undefined
  try {
    file = await prepareResolverVideo(video, { referer })
  } catch (error) {
    if (Config.resolver.sending.videoFailureFallbackEnabled !== false) {
      await replyText(e, `视频下载失败：${errorText(error) || '未知错误'}${pageUrl ? `\n原链接：${pageUrl}` : ''}`)
    }
    return
  }
  if (!file) return
  await replyVideo(e, file, pageUrl)
}

export const replyResolverVideos = async (e: Message, post: ResolvedPost) => {
  const referer = videoReferer(post)
  for (const video of post.videos.slice(0, 9)) {
    await replyResolverVideo(e, video, post.pageUrl, referer)
  }
}

export type ReplyHelperOptions = {
  /** 是否引用触发消息, 交互性回复默认引用 (node-karin 原生默认不引用). */
  reply?: boolean
  /** 发送后自动撤回的秒数, 用于语音上传占位等临时提示. */
  recallMsg?: number
}

const replyOptions = (options?: ReplyHelperOptions) => {
  const at = options?.reply === false ? { reply: false } : { reply: true }
  return options?.recallMsg ? { ...at, recallMsg: options.recallMsg } : at
}

export const replyText = async (e: Message, text: string, options?: ReplyHelperOptions) => {
  await e.reply(`${prefix()}：${text}` as ReplyPayload, replyOptions(options))
}

export const replyPlainText = async (e: Message, text: string, options?: ReplyHelperOptions) => {
  await e.reply(text as ReplyPayload, replyOptions(options))
}

export const replyImage = async (e: Message, url: string, title?: string) => {
  const elements = [
    title ? segment.text(`${prefix()}：${title}`) : undefined,
    segment.image(url)
  ].filter(Boolean)

  try {
    await sendWithMediaRetry(payload => e.reply(payload as ReplyPayload), elements)
  } catch {
    await replyText(e, `${title ? `${title}\n` : ''}${url}`)
  }
}

export const replyMusicList = async (e: Message, items: MusicItem[], page: number, options?: { startIndex?: number }) => {
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
      duration
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
      html: buildMusicListCardHtml(rows, page, startIndex),
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
    const result = await e.reply(segment.record(voiceFile || playable.audioUrl) as ReplyPayload)
    return result?.messageId
  } catch {
    if (voiceFile && voiceFile !== playable.audioUrl) {
      try {
        const result = await e.reply(segment.record(playable.audioUrl) as ReplyPayload)
        return result?.messageId
      } catch {
        // 直链也失败, 继续降级到音乐卡 + 文本链接, 保证不空回.
      }
    }
    await replyMusicPlayable(e, playable)
    return undefined
  }
}

const isFailure = (result: ResolverResult): result is ResolverFailure => 'ok' in result && result.ok === false

const resolverCommentsEnabled = () => Config.resolver.commentsEnabled !== false

const canSendForward = canSendResolverForward

const resolvedPostText = (post: ResolvedPost) => {
  const title = post.title ? `，${post.title}` : ''
  return `识别：${post.displayName}${title}${post.description ? `\n${post.description}` : ''}${post.pageUrl ? `\n${post.pageUrl}` : ''}`
}

const resolverImageUrls = (images: string[]) => {
  const media = Config.resolver.media
  if (media.dedupeImages !== false) {
    return dedupeImageUrls(images, {
      filterLowQuality: media.filterLowQualityImages !== false
    })
  }

  const urls = images.map(url => url.trim()).filter(Boolean)
  if (media.filterLowQualityImages === false) return urls
  const usable = urls.filter(isUsableImageUrl)
  if (usable.length > 0) return usable
  return urls.filter(url => imageQuality(url) !== 'blurred')
}

const resolverImageDedupeOptions = () => ({
  dedupe: Config.resolver.media.dedupeImages !== false,
  filterLowQuality: Config.resolver.media.filterLowQualityImages !== false
})

// 兼容既有导出: 缓存扰动与重发逻辑已收拢到 services/mediaRetry, 其它调用方仍从这里取.
export { bustImageUrls, withCacheBuster } from '@/services/mediaRetry'

/** 转发按 50 条分批,超限分多条发出(参考 R sendImagesInBatches). */
const FORWARD_BATCH_SIZE = 50

const sendForwardBatched = async (e: Message, post: ResolvedPost, nodes: CustomNodeElement[], prompt: string, summary: string) => {
  for (let i = 0; i < nodes.length; i += FORWARD_BATCH_SIZE) {
    const chunk = nodes.slice(i, i + FORWARD_BATCH_SIZE)
    const suffix = nodes.length > FORWARD_BATCH_SIZE ? `(${Math.floor(i / FORWARD_BATCH_SIZE) + 1}/${Math.ceil(nodes.length / FORWARD_BATCH_SIZE)})` : ''
    await sendResolverForward(e, post, chunk, prompt, `${summary}${suffix}`)
  }
}

const directResolvedPost = async (e: Message, post: ResolvedPost, text: string) => {
  const imageUrls = resolverImageUrls(post.images).slice(0, 9)
  const elements = [
    segment.text(text),
    ...imageUrls.map(url => segment.image(url))
  ]
  try {
    await sendWithMediaRetry(payload => e.reply(payload as ReplyPayload), elements)
  } catch {
    await replyPlainText(e, [text, ...imageUrls].join('\n'))
  }
}

const cardResolvedPost = async (e: Message, post: ResolvedPost, text: string) => {
  try {
    const images = await renderCardImage({
      name: `resolver-${post.platform}`,
      html: buildResolverCardHtml(post),
      width: 920
    })
    const elements = [
      ...images,
      ...resolverImageUrls(post.images).slice(0, 9).map(url => segment.image(url))
    ]
    await sendWithMediaRetry(payload => e.reply(payload as ReplyPayload), elements)
  } catch (error) {
    logCardRenderFailure(`resolver-${post.platform}`, error)
    await directResolvedPost(e, post, text)
  }
}

const richResolverPreviewCopy = (post: ResolvedPost) => {
  if (post.platform === 'bilibili') return '已识别B站视频，简介和视频将随后发送。'
  if (post.platform === 'kuaishou') return '已识别快手作品，完整内容将随后发送。'
  if (post.platform === 'xiaoheihe') return '已识别小黑盒分享，完整内容将随后发送。'
  if (post.platform === 'xiaohongshu') return '已识别小红书笔记，完整图文将随后发送。'
  if (post.platform === 'weibo') return '已识别微博分享，正文和评论将随后发送。'
  if (post.platform === 'tieba') return '已识别贴吧帖子，正文和回复将随后发送。'
  if (post.platform === 'general') return '已识别通用解析结果，内容将随后发送。'
  return `已识别${post.displayName}分享，完整内容将随后发送。`
}

const resolverPreviewCardPost = async (e: Message, post: ResolvedPost, text: string) => {
  try {
    const renderPost = Config.resolver.media.inlinePreviewCover === false ? post : await inlinePreviewCover(post)
    const images = await renderCardImage({
      name: `resolver-${post.platform}-preview`,
      html: buildResolverPreviewCardHtml(renderPost, richResolverPreviewCopy(renderPost), {
        commentsEnabled: resolverCommentsEnabled()
      }),
      width: 920
    })
    await sendWithMediaRetry(payload => e.reply(payload as ReplyPayload), images)
  } catch (error) {
    logCardRenderFailure(`resolver-${post.platform}-preview`, error)
    await directResolvedPost(e, post, text)
  }
}

const replyResolvedPostForward = async (e: Message, post: ResolvedPost, text: string) => {
  const identity = resolveEventForwardIdentity(e, post.displayName)
  const imageUrls = resolverImageUrls(post.images)
  const nodes = [buildFakeForwardNode([
    segment.text(text),
    ...imageUrls.map(url => segment.image(url))
  ], identity.id, identity.name)]
  const isLongText = (post.description?.length || 0) > resolverLongTextLength
  const summary = imageUrls.length > 1
    ? `查看${imageUrls.length}张图片`
    : isLongText
      ? '查看完整解析内容'
      : '查看解析内容'

  await sendForwardBatched(e, post, nodes, `${post.displayName}解析结果`, summary)
}

const richResolverPlatforms = new Set<ResolvedPost['platform']>([
  'bilibili',
  'kuaishou',
  'xiaoheihe',
  'xiaohongshu',
  'weibo',
  'tieba',
  'general'
])

const hasRichResolverExtras = (post: ResolvedPost) => (
  richResolverPlatforms.has(post.platform) &&
  Boolean(post.extras?.contentBlocks?.length || (resolverCommentsEnabled() && post.extras?.commentBlocks?.length))
)

const replyRichResolverPost = async (e: Message, post: ResolvedPost, text: string) => {
  await resolverPreviewCardPost(e, post, text)
  if (!canSendForward(e)) {
    await directResolvedPost(e, post, text)
    return
  }

  try {
    const copy = resolverForwardCopy(post)
    const contentBlocks = post.extras?.contentBlocks || []
    if (Config.resolver.sending.contentForwardEnabled !== false && contentBlocks.length > 0) {
      await sendForwardBatched(e, post, buildResolverContentNodes(e, post, contentBlocks, resolverImageDedupeOptions()), copy.contentPrompt, '查看完整图文')
    }

    const commentBlocks = resolverCommentsEnabled() ? post.extras?.commentBlocks || [] : []
    if (commentBlocks.length > 0) {
      const identity = resolveEventForwardIdentity(e, post.displayName)
      await sendForwardBatched(e, post, buildResolverCommentNodes(commentBlocks, identity), copy.commentPrompt, `查看${commentBlocks.length}条${copy.commentUnit}`)
    }
  } catch {
    await directResolvedPost(e, post, text)
  }
}

export const replyResolvedPost = async (e: Message, result: ResolverResult) => {
  if (isFailure(result)) {
    try {
      const images = await renderCardImage({
        name: `resolver-error-${result.platform}`,
        html: buildErrorCardHtml({
          title: `${result.displayName}解析失败`,
          subtitle: result.displayName,
          reason: result.reason,
          suggestion: '可以检查 Cookie、代理和平台接口状态；渲染不可用时会自动退回文本提示。',
          details: [`platform=${result.platform}`]
        }),
        width: 920
      })
      await sendWithMediaRetry(payload => e.reply(payload as ReplyPayload), images)
    } catch (error) {
      logCardRenderFailure(`resolver-error-${result.platform}`, error)
      await replyPlainText(e, `${result.displayName}解析失败：${result.reason}`)
    }
    return
  }

  const post = result as ResolvedPost
  const text = resolvedPostText(post)
  if (hasRichResolverExtras(post)) {
    await replyRichResolverPost(e, post, text)
    await replyResolverVideos(e, post)
    return
  }

  const shouldForward = post.images.length > 1 || (post.description?.length || 0) > resolverLongTextLength

  if (shouldForward && canSendForward(e)) {
    try {
      await replyResolvedPostForward(e, post, text)
    } catch {
      await directResolvedPost(e, post, text)
    }
  } else {
    await cardResolvedPost(e, post, text)
  }

  await replyResolverVideos(e, post)
}
