import { fetchText } from '@/services/http'

import { dedupeImageUrls, selectBestImageUrl } from './media'
import { logResolverStage } from './resolverLog'
import type { ResolvedPost, ResolverFailure, ResolverResult, RichContentBlock } from './types'

const failure = (reason: string): ResolverFailure => ({
  platform: 'xiaohongshu',
  displayName: '小红书',
  ok: false,
  reason
})

const asObject = (value: unknown): Record<string, any> | undefined => {
  return typeof value === 'object' && value !== null ? value as Record<string, any> : undefined
}

const pushUnique = (items: string[], value: unknown) => {
  if (typeof value === 'string' && value.trim() && !items.includes(value)) items.push(value)
}

const pushUniqueMany = (items: string[], value: unknown) => {
  if (Array.isArray(value)) {
    for (const item of value) pushUnique(items, item)
    return
  }
  pushUnique(items, value)
}

const compactString = (value: unknown) => typeof value === 'string' ? value.trim() : ''

const bestImageUrl = (image: Record<string, any>) => {
  return selectBestImageUrl([
    compactString(image.urlDefault),
    compactString(image.url),
    compactString(image.urlPre)
  ])
}

const xiaohongshuTags = (note: Record<string, any>) => {
  const tags: string[] = []
  for (const tag of Array.isArray(note.tagList) ? note.tagList : []) {
    const value = compactString(tag?.name || tag?.tagName)
    if (value && !tags.includes(value)) tags.push(value)
  }
  return tags
}

export const extractXiaohongshuNoteId = (url: string) => {
  try {
    const parsed = new URL(url)
    return parsed.pathname.match(/\/(?:explore|discovery\/item)\/([^/?]+)/)?.[1]
  } catch {
    return undefined
  }
}

const looksLikeNote = (value: unknown) => {
  const note = asObject(value)
  if (!note) return false
  return Boolean(note.title || note.desc || note.imageList || note.video)
}

const selectFromNoteDetailMap = (value: unknown, noteId?: string) => {
  const noteDetailMap = asObject(value)
  if (!noteDetailMap) return undefined

  const detail = noteId ? asObject(noteDetailMap[noteId]) : undefined
  const firstDetail = detail ?? asObject(Object.values(noteDetailMap)[0])
  return asObject(firstDetail?.note) ?? firstDetail
}

const selectNote = (payload: unknown, noteId?: string) => {
  const root = asObject(payload)
  const noteContainer = asObject(root?.note)

  return selectFromNoteDetailMap(root?.noteDetailMap, noteId)
    ?? selectFromNoteDetailMap(root?.state?.note?.noteDetailMap, noteId)
    ?? selectFromNoteDetailMap(noteContainer?.noteDetailMap, noteId)
    ?? (looksLikeNote(noteContainer) ? noteContainer : undefined)
}

export const normalizeXiaohongshuNote = (pageUrl: string, payload: unknown): ResolvedPost | ResolverFailure => {
  const note = selectNote(payload, extractXiaohongshuNoteId(pageUrl))
  if (!note) return failure('小红书页面数据异常')

  const images: string[] = []
  const videos: string[] = []

  for (const image of Array.isArray(note.imageList) ? note.imageList : []) {
    const imageObject = asObject(image)
    if (imageObject) pushUnique(images, bestImageUrl(imageObject))
  }
  const normalizedImages = dedupeImageUrls(images)
  images.splice(0, images.length, ...normalizedImages)

  const stream = asObject(note.video?.media?.stream)
  for (const item of Array.isArray(stream?.h264) ? stream.h264 : []) {
    pushUniqueMany(videos, item?.backupUrls)
    pushUniqueMany(videos, item?.backupUrl)
    pushUnique(videos, item?.masterUrl)
  }
  for (const item of Array.isArray(stream?.h265) ? stream.h265 : []) {
    pushUniqueMany(videos, item?.backupUrls)
    pushUniqueMany(videos, item?.backupUrl)
    pushUnique(videos, item?.masterUrl)
  }

  if (images.length === 0 && videos.length === 0) return failure('未找到小红书媒体资源')

  const videoLike = compactString(note.type).toLowerCase() === 'video' || Boolean(note.video)
  const videoFallback = videoLike && videos.length === 0 && images.length > 0
    ? '视频资源暂不可用，已降级为封面和原链接。'
    : ''
  const description = [String(note.desc || ''), videoFallback].filter(Boolean).join('\n')
  const contentBlocks: RichContentBlock[] = [
    description.trim() ? { type: 'text', text: description } : undefined,
    ...images.map(url => ({ type: 'image' as const, url }))
  ].filter(Boolean) as RichContentBlock[]
  const tags = xiaohongshuTags(note)
  const authorAvatar = compactString(note.user?.avatar || note.user?.image || note.user?.imageUrl)

  return {
    platform: 'xiaohongshu',
    displayName: '小红书笔记',
    title: String(note.title || '小红书笔记'),
    description,
    author: note.user?.nickname,
    pageUrl,
    videos,
    images,
    extras: {
      coverUrl: images[0],
      contentBlocks,
      tags,
      authorAvatar: authorAvatar || undefined,
      createdAt: note.time || note.createTime
    }
  }
}

const parseEmbeddedJson = (html: string) => {
  const patterns = [
    /<script[^>]+id="__INITIAL_STATE__"[^>]*>([\s\S]*?)<\/script>/i,
    /window\.__INITIAL_STATE__\s*=\s*({[\s\S]*?})<\/script>/i
  ]

  for (const pattern of patterns) {
    const raw = html.match(pattern)?.[1]?.trim()
    if (!raw) continue

    try {
      return JSON.parse(raw.replace(/undefined/g, 'null'))
    } catch {
      continue
    }
  }

  return undefined
}

const expandShortUrl = async (url: string) => {
  if (!url.includes('xhslink.com')) return url
  const response = await fetch(url, { redirect: 'follow' })
  return response.url || url
}

export const resolveXiaohongshu = async (url: string, cookie = ''): Promise<ResolverResult> => {
  logResolverStage({ platform: 'xiaohongshu', stage: 'cookie', ok: Boolean(cookie), cookie })
  if (!cookie) return failure('需要在 resolver.yaml 配置 xiaohongshu Cookie')

  let finalUrl = url
  try {
    finalUrl = await expandShortUrl(url)
    logResolverStage({ platform: 'xiaohongshu', stage: 'prepare', ok: true, url: finalUrl })
  } catch {
    finalUrl = url
    logResolverStage({ platform: 'xiaohongshu', stage: 'prepare', ok: false, reason: 'short url expand failed', url })
  }

  if (!extractXiaohongshuNoteId(finalUrl)) {
    logResolverStage({ platform: 'xiaohongshu', stage: 'match', ok: false, reason: 'missing note id', url: finalUrl })
    return failure('无法识别小红书笔记 ID')
  }

  const html = await fetchText(finalUrl, {
    headers: {
      Cookie: cookie,
      Referer: 'https://www.xiaohongshu.com/'
    }
  })
  logResolverStage({ platform: 'xiaohongshu', stage: 'api', ok: true, url: finalUrl, cookie, extra: { source: 'web-html' } })
  const state = parseEmbeddedJson(html)
  if (!state) {
    logResolverStage({ platform: 'xiaohongshu', stage: 'normalize', ok: false, reason: 'embedded state missing', url: finalUrl })
    return failure('小红书页面数据异常')
  }

  const result = normalizeXiaohongshuNote(finalUrl, state)
  logResolverStage({
    platform: 'xiaohongshu',
    stage: 'normalize',
    ok: !('ok' in result),
    reason: 'ok' in result ? result.reason : undefined,
    url: finalUrl
  })
  return result
}
