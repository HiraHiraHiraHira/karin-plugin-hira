import * as fs from 'node:fs'
import path from 'node:path'

import type { Message } from 'node-karin'
import { logger, segment } from 'node-karin'

import { Config } from '@/config'
import type { ResolvedPost, ResolverVideo } from '@/resolvers/types'
import { downloadFile } from '@/runtime/downloader'
import { runFfmpeg } from '@/runtime/ffmpeg'
import { createTempFilePath } from '@/runtime/temp'

import type { ReplyHelperOptions } from './message'

type ReplyPayload = Parameters<Message['reply']>[0]

const videoMessageLimitBytes = 100 * 1024 * 1024

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

const safeRemoveTemp = (file: string | undefined) => {
  if (!file) return
  try {
    fs.rmSync(file, { force: true })
  } catch {
    // 清理中间临时文件失败不影响发送流程
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
  const runtimeConfig = Config.runtime
  const output = createTempFilePath('video', ext)
  await downloadFile({
    url,
    output,
    headers: {
      ...(referer ? { Referer: referer } : {}),
      Accept: '*/*'
    },
    timeoutMs: Math.max(5, runtimeConfig.downloadTimeoutSeconds) * 1000,
    maxBytes: runtimeConfig.maxVideoFileSizeBytes,
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
 * 中间产物（原始分轨、未转封装视频）在下一步成功后立即清理，只保留最终发出的文件。
 */
const audioTrackOrDefault = async (audioUrl: string | undefined, referer?: string) => {
  if (!audioUrl) return { file: undefined as string | undefined, owned: false }
  if (!isRemoteMedia(audioUrl)) return { file: audioUrl, owned: false }
  try {
    return { file: await downloadResolverMedia(audioUrl, 'm4a', referer), owned: true }
  } catch (error) {
    // 音轨失败不应丢掉已下载的视频: 跳过合并, 继续发视频本体 (R 同款降级).
    logger.warn(`[hira] audio track download failed, sending video only: ${error instanceof Error ? error.message : String(error)}`)
    return { file: undefined, owned: false }
  }
}

export const prepareResolverVideo = async (video: ResolverVideo, options?: { referer?: string }): Promise<string | undefined> => {
  const sourceUrl = video.url?.trim()
  if (!sourceUrl) return undefined
  // HLS 播放列表必须先合并分片, 发送侧没有该能力, 绝不把 playlist 当媒体文件发送.
  if (/\.m3u8(?:$|[?#])/i.test(sourceUrl)) throw new Error('暂不支持 HLS (m3u8) 直链，请点击原链接观看')
  const audio = await audioTrackOrDefault(video.audioUrl?.trim(), options?.referer)
  const remote = isRemoteMedia(sourceUrl)

  if (!remote) {
    if (!audio.file) return sourceUrl
    const merged = await tryFfmpeg({
      format: 'merge',
      videoInput: sourceUrl,
      audioInput: audio.file,
      output: createTempFilePath('video', 'mp4')
    })
    if (audio.owned) safeRemoveTemp(audio.file)
    return merged || sourceUrl
  }

  let videoFile = await downloadResolverMedia(sourceUrl, videoExtension(sourceUrl), options?.referer)
  if (audio.file) {
    const merged = await tryFfmpeg({
      format: 'merge',
      videoInput: videoFile,
      audioInput: audio.file,
      output: createTempFilePath('video', 'mp4')
    })
    if (audio.owned) safeRemoveTemp(audio.file)
    if (merged) {
      safeRemoveTemp(videoFile)
      videoFile = merged
    }
  }

  const remuxed = await tryFfmpeg({
    format: 'qq-video',
    input: videoFile,
    output: createTempFilePath('video', 'mp4')
  })
  if (remuxed) {
    safeRemoveTemp(videoFile)
    return remuxed
  }
  return videoFile
}

type ReplyTextFn = (e: Message, text: string, options?: ReplyHelperOptions) => Promise<void>

const uploadVideoFile = async (e: Message, file: string, replyText: ReplyTextFn, size?: number) => {
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

const replyVideo = async (e: Message, file: string, replyText: ReplyTextFn, pageUrl?: string) => {
  const size = getLocalFileSize(file)
  if (size && size > videoMessageLimitBytes) {
    await uploadVideoFile(e, file, replyText, size)
    return
  }

  try {
    await e.reply(segment.video(toVideoMessageFile(file)) as ReplyPayload)
  } catch (error) {
    if (isVideoTooLargeError(error)) {
      await uploadVideoFile(e, file, replyText, size)
      return
    }
    if (Config.resolver.sending.videoFailureFallbackEnabled !== false) {
      await replyText(e, `视频发送失败：${error instanceof Error ? error.message : String(error)}${pageUrl ? `\n原链接：${pageUrl}` : ''}`)
    }
  }
}

const replyResolverVideo = async (e: Message, video: ResolverVideo, replyText: ReplyTextFn, pageUrl?: string, referer?: string) => {
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
  await replyVideo(e, file, replyText, pageUrl)
}

export const createReplyResolverVideos = (replyText: ReplyTextFn) => async (e: Message, post: ResolvedPost) => {
  const referer = videoReferer(post)
  for (const video of post.videos.slice(0, 9)) {
    await replyResolverVideo(e, video, replyText, post.pageUrl, referer)
  }
}
