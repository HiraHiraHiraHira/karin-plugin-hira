import { fetchResolverText } from '@/services/resolverHttp'

import type { ResolvedPost, ResolverFailure, ResolverResult, RichContentBlock } from './types'

/**
 * AcFun 原生解析：R utils/acfun.js 的 parseUrl。
 * 稿件页带 `?quickViewId=videoInfo_new&ajaxpipe=1` 会返回包含
 * `window.pageInfo = window.videoInfo = {...}` 的片段，其中已有 ac 号、标题、作者、
 * 简介和播放信息，无需登录；下载/合并由发送侧负责，这里只登记直链。
 */

const asObject = (value: unknown): Record<string, any> | undefined => (
  typeof value === 'object' && value !== null ? value as Record<string, any> : undefined
)

const firstString = (...values: unknown[]) => {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim()
    if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  }
  return undefined
}

const firstNumber = (...values: unknown[]) => {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) return value
    if (typeof value === 'string' && /^\d+$/.test(value.trim())) return Number.parseInt(value.trim(), 10)
  }
  return undefined
}

/** `ac12345` / `https://www.acfun.cn/v/ac12345` / `?ac=12345` 都归一成数字稿件号。 */
export const extractAcfunId = (url: string) => (
  url.match(/\/v\/ac(\d+)/i)?.[1]
  || url.match(/[?&]ac=(\d+)/i)?.[1]
  || url.match(/\bac(\d{4,})\b/i)?.[1]
)

/** 页面脚本里的 JSON 带双重转义，先还原 `\\\\"` 再还原 `\\"`，顺序反过来会破坏内容。 */
export const extractAcfunVideoInfo = (text: string) => {
  const marker = 'window.pageInfo = window.videoInfo ='
  const start = text.indexOf(marker)
  if (start < 0) return undefined
  const tail = text.slice(start + marker.length)
  const end = tail.indexOf('</script>')
  const raw = (end >= 0 ? tail.slice(0, end) : tail).trim()
  if (!raw) return undefined

  const unescapedOnce = (value: string) => value.replace(/\\\\"/g, '\\"').replace(/\\"/g, '"')

  let candidate = raw
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return JSON.parse(candidate) as Record<string, any>
    } catch {
      const next = unescapedOnce(candidate)
      if (next === candidate) return undefined
      candidate = next
    }
  }
  return undefined
}

const representationUrls = (info: Record<string, any>) => {
  const current = asObject(info.currentVideoInfo)
  const ksPlayRaw = firstString(current?.ksPlayJson)
  if (!ksPlayRaw) return []

  try {
    const ksPlay = JSON.parse(ksPlayRaw)
    const sets = Array.isArray(ksPlay.adaptationSet) ? ksPlay.adaptationSet : []
    return sets.flatMap((set: unknown) => {
      const representations = asObject(set)?.representation
      const list = Array.isArray(representations) ? representations : []
      return list.map(item => firstString(asObject(item)?.url)).filter(Boolean)
    })
  } catch {
    return []
  }
}

/** 有 mp4 直链时优先用它，m3u8 只作为直链候补（发送侧按需转封装）。 */
const streamUrls = (info: Record<string, any>) => {
  const streams = Array.isArray(info.currentVideoInfo?.streams) ? info.currentVideoInfo.streams : []
  const mp4: string[] = []
  for (const stream of streams) {
    const playUrls = asObject(stream)?.playUrls
    const list = Array.isArray(playUrls) ? playUrls : []
    for (const play of list) {
      const url = firstString(asObject(play)?.url, asObject(play)?.playUrl)
      if (url) mp4.push(url)
    }
  }
  return [...mp4, ...representationUrls(info)]
}

const failure = (reason: string): ResolverFailure => ({
  platform: 'general',
  displayName: 'AcFun',
  ok: false,
  reason
})

export const normalizeAcfunVideo = (url: string, info: unknown): ResolvedPost | ResolverFailure => {
  const video = asObject(info)
  if (!video) return failure('AcFun 页面没有 videoInfo 数据')

  const id = firstString(video.dougaId)
  const title = firstString(video.title) || (id ? `ac${id}` : 'AcFun 视频')
  const author = asObject(video.user)
  const cover = firstString(
    video.cover,
    video.coverUrl,
    video.cover_url,
    video.image,
    asObject(video.currentVideoInfo)?.cover,
    asObject(video.currentVideoInfo)?.coverUrl
  )

  const stats = [
    ['播放', firstNumber(video.viewCount, video.views)],
    ['点赞', firstNumber(video.likeCount, video.likes)],
    ['弹幕', firstNumber(video.danmakuCount, video.danmakuCountShow)],
    ['评论', firstNumber(video.commentCount, video.comments)],
    ['收藏', firstNumber(video.stowCount, video.collectCount)]
  ].filter((entry): entry is [string, number] => entry[1] !== undefined)

  const description = [
    firstString(video.description),
    stats.length > 0 ? stats.map(([label, value]) => `${label} ${value}`).join(' · ') : ''
  ].filter(Boolean).join('\n')

  const contentBlocks: RichContentBlock[] = [
    { type: 'text', text: `ac${id || ''} ${title}`.trim() },
    ...(cover ? [{ type: 'image' as const, url: cover }] : [])
  ]
  const videoDescription = firstString(video.description)
  if (videoDescription) contentBlocks.push({ type: 'text', text: videoDescription })

  const createdAt = firstNumber(video.createTime, video.createTimeMillis)
  const pageUrl = id ? `https://www.acfun.cn/v/ac${id}` : url

  return {
    platform: 'general',
    displayName: 'AcFun',
    title,
    description,
    author: firstString(author?.name),
    pageUrl,
    videos: streamUrls(video).map(videoUrl => ({ url: videoUrl })),
    images: cover ? [cover] : [],
    extras: {
      coverUrl: cover,
      authorAvatar: firstString(author?.avatar, author?.avatarUrl),
      contentBlocks,
      tags: ['AcFun'],
      ...(createdAt ? { createdAt } : {})
    }
  }
}

export const resolveAcfun = async (url: string): Promise<ResolverResult> => {
  const id = extractAcfunId(url)
  if (!id) return failure('无法识别 AcFun 稿件号')

  try {
    const html = await fetchResolverText(`https://www.acfun.cn/v/ac${id}?quickViewId=videoInfo_new&ajaxpipe=1`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Referer: `https://www.acfun.cn/v/ac${id}`
      }
    })
    const info = extractAcfunVideoInfo(html)
    if (!info) return failure('AcFun 页面未找到 videoInfo')
    return normalizeAcfunVideo(url, info)
  } catch (error) {
    return failure(error instanceof Error ? error.message : String(error))
  }
}
