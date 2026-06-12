import { fetchJson, fetchText } from '@/services/http'

import { resolveByGeneralApis } from './general'
import type { ResolvedPost, ResolverFailure, ResolverResult } from './types'

const stripHtml = (html: string) => html
  .replace(/<img[^>]+src="([^"]+)"[^>]*>/g, '')
  .replace(/<[^>]+>/g, '')
  .replace(/&nbsp;/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()

const imagesFromHtml = (html: string) => [...html.matchAll(/<img[^>]+src="([^"]+)"/g)].map(match => match[1])

const failure = (reason: string): ResolverFailure => ({
  platform: 'tieba',
  displayName: '贴吧',
  ok: false,
  reason
})

export const normalizeTiebaPost = (url: string, payload: unknown): ResolvedPost | ResolverFailure => {
  const root = payload as {
    thread?: {
      title?: string
      author?: { name?: string }
      content?: string
    }
    posts?: Array<{ author?: { name?: string }, content?: string, images?: string[] }>
  }
  const thread = root.thread
  if (!thread) return failure('贴吧接口返回异常')

  const images = [
    ...imagesFromHtml(thread.content || ''),
    ...(root.posts ?? []).flatMap(post => post.images ?? []),
    ...(root.posts ?? []).flatMap(post => imagesFromHtml(post.content || ''))
  ].filter(Boolean)

  const comments = (root.posts ?? []).slice(0, 5).map(post => {
    const author = post.author?.name || '匿名用户'
    const text = stripHtml(post.content || '')
    return text ? `${author}：${text}` : ''
  }).filter(Boolean)

  return {
    platform: 'tieba',
    displayName: '贴吧',
    title: thread.title || '贴吧帖子',
    author: thread.author?.name,
    description: [
      stripHtml(thread.content || ''),
      comments.length > 0 ? `热门回复\n${comments.join('\n')}` : ''
    ].filter(Boolean).join('\n\n'),
    pageUrl: url,
    videos: [],
    images: [...new Set(images)]
  }
}

export const normalizeHibiTiebaPost = (url: string, payload: unknown): ResolvedPost | ResolverFailure => {
  const root = payload as {
    post_list?: Array<{
      title?: string
      author?: { name?: string }
      content?: Array<{ text?: string, cdn_src?: string, link?: string }>
    }>
  }
  const posts = root.post_list ?? []
  const top = posts[0]
  if (!top) return failure('贴吧接口返回异常')

  const images: string[] = []
  const videos: string[] = []

  const normalizeContent = (content: Array<{ text?: string, cdn_src?: string, link?: string }> = []) => {
    const texts: string[] = []
    for (const item of content) {
      if (item.text) texts.push(item.text)
      if (item.cdn_src && !images.includes(item.cdn_src)) images.push(item.cdn_src)
      if (item.link && !videos.includes(item.link)) videos.push(item.link)
    }
    return texts.join('\n')
  }

  const topText = normalizeContent(top.content)
  const comments = posts.slice(1, 6).map(post => normalizeContent(post.content)).filter(Boolean)

  return {
    platform: 'tieba',
    displayName: '贴吧',
    title: top.title || '贴吧帖子',
    author: top.author?.name,
    description: [
      topText,
      comments.length > 0 ? `热门回复\n${comments.join('\n')}` : ''
    ].filter(Boolean).join('\n\n'),
    pageUrl: url,
    videos,
    images
  }
}

const threadIdFromUrl = (url: string) => {
  return new URL(url).pathname.match(/\/p\/(\d+)/)?.[1]
}

export const resolveTieba = async (url: string, generalApis: string[]): Promise<ResolverResult> => {
  const tid = threadIdFromUrl(url)
  if (tid) {
    try {
      const data = await fetchJson(`https://api.obfs.dev/api/tieba/post?tid=${encodeURIComponent(tid)}`)
      if ((data as { post_list?: unknown }).post_list) {
        const hibiResult = normalizeHibiTiebaPost(url, data)
        if (!('ok' in hibiResult)) return hibiResult
      }
      const result = normalizeTiebaPost(url, data)
      if (!('ok' in result)) return result
    } catch {
      try {
        const html = await fetchText(url)
        const title = stripHtml(html.match(/<title>(.*?)<\/title>/i)?.[1] || '贴吧帖子')
        const images = imagesFromHtml(html).slice(0, 9)
        return {
          platform: 'tieba',
          displayName: '贴吧',
          title,
          pageUrl: url,
          videos: [],
          images
        }
      } catch {
        // Fall through to general APIs.
      }
    }
  }

  return resolveByGeneralApis('贴吧', url, generalApis)
}
