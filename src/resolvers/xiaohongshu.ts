import { fetchText } from '@/services/http'

import type { ResolvedPost, ResolverFailure, ResolverResult } from './types'

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

export const extractXiaohongshuNoteId = (url: string) => {
  try {
    const parsed = new URL(url)
    return parsed.pathname.match(/\/(?:explore|discovery\/item)\/([^/?]+)/)?.[1]
  } catch {
    return undefined
  }
}

const selectNote = (payload: unknown) => {
  const root = asObject(payload)
  const directNote = asObject(root?.note)
  if (directNote) return directNote

  const noteDetailMap = asObject(root?.noteDetailMap)
    ?? asObject(root?.state?.note?.noteDetailMap)
    ?? asObject(root?.note?.noteDetailMap)
  const firstDetail = noteDetailMap ? asObject(Object.values(noteDetailMap)[0]) : undefined
  return asObject(firstDetail?.note) ?? firstDetail
}

export const normalizeXiaohongshuNote = (pageUrl: string, payload: unknown): ResolvedPost | ResolverFailure => {
  const note = selectNote(payload)
  if (!note) return failure('小红书页面数据异常')

  const images: string[] = []
  const videos: string[] = []

  for (const image of Array.isArray(note.imageList) ? note.imageList : []) {
    pushUnique(images, image?.urlDefault)
    pushUnique(images, image?.url)
    pushUnique(images, image?.urlPre)
  }

  const stream = asObject(note.video?.media?.stream)
  for (const item of Array.isArray(stream?.h264) ? stream.h264 : []) {
    pushUnique(videos, item?.masterUrl)
  }
  for (const item of Array.isArray(stream?.h265) ? stream.h265 : []) {
    pushUnique(videos, item?.masterUrl)
  }

  if (images.length === 0 && videos.length === 0) return failure('未找到小红书媒体资源')

  return {
    platform: 'xiaohongshu',
    displayName: '小红书',
    title: String(note.title || '小红书笔记'),
    description: String(note.desc || ''),
    author: note.user?.nickname,
    pageUrl,
    videos,
    images
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
  if (!cookie) return failure('需要在 resolver.yaml 配置 xiaohongshu Cookie')

  let finalUrl = url
  try {
    finalUrl = await expandShortUrl(url)
  } catch {
    finalUrl = url
  }

  if (!extractXiaohongshuNoteId(finalUrl)) return failure('无法识别小红书笔记 ID')

  const html = await fetchText(finalUrl, {
    headers: {
      Cookie: cookie,
      Referer: 'https://www.xiaohongshu.com/'
    }
  })
  const state = parseEmbeddedJson(html)
  if (!state) return failure('小红书页面数据异常')

  return normalizeXiaohongshuNote(finalUrl, state)
}
