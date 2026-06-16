import { fetchJson, fetchText } from '@/services/http'

import { resolveByGeneralApis } from './general'
import type { ResolvedPost, ResolverFailure, ResolverResult, RichCommentBlock, RichContentBlock } from './types'
import type { ShareCardMeta } from './url'

const stripHtml = (html: string) => html
  .replace(/<img[^>]+src="([^"]+)"[^>]*>/g, '')
  .replace(/<[^>]+>/g, '')
  .replace(/&nbsp;/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()

const imgTagRegExp = /<img\b[^>]*src="([^"]+)"[^>]*>/g

const imagesFromHtml = (html: string) => [...html.matchAll(imgTagRegExp)].map(match => match[1])

const htmlContentBlocks = (html: string): RichContentBlock[] => {
  const blocks: RichContentBlock[] = []
  let cursor = 0
  for (const match of html.matchAll(imgTagRegExp)) {
    const index = match.index ?? cursor
    const text = stripHtml(html.slice(cursor, index))
    if (text) blocks.push({ type: 'text', text })
    if (match[1]) blocks.push({ type: 'image', url: match[1] })
    cursor = index + match[0].length
  }
  const rest = stripHtml(html.slice(cursor))
  if (rest) blocks.push({ type: 'text', text: rest })
  return blocks
}

const dedupeContentBlocks = (blocks: RichContentBlock[]) => {
  const seenImages = new Set<string>()
  return blocks.filter(block => {
    if (block.type === 'text') return Boolean(block.text)
    if (seenImages.has(block.url)) return false
    seenImages.add(block.url)
    return true
  })
}

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
  const contentBlocks = dedupeContentBlocks(htmlContentBlocks(thread.content || ''))
  const commentBlocks: RichCommentBlock[] = (root.posts ?? []).slice(0, 5).map(post => ({
    author: post.author?.name || '匿名用户',
    text: stripHtml(post.content || ''),
    images: [...new Set([
      ...(post.images ?? []),
      ...imagesFromHtml(post.content || '')
    ].filter(Boolean))]
  })).filter(comment => comment.text || comment.images.length > 0)

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
    images: [...new Set(images)],
    extras: {
      contentBlocks,
      commentBlocks
    }
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

  const normalizeBlocks = (content: Array<{ text?: string, cdn_src?: string }> = []) => {
    const blocks: RichContentBlock[] = []
    for (const item of content) {
      if (item.text) blocks.push({ type: 'text', text: item.text })
      if (item.cdn_src) blocks.push({ type: 'image', url: item.cdn_src })
    }
    return blocks
  }

  const topText = normalizeContent(top.content)
  const comments = posts.slice(1, 6).map(post => normalizeContent(post.content)).filter(Boolean)
  const contentBlocks = normalizeBlocks(top.content)
  const commentBlocks: RichCommentBlock[] = posts.slice(1, 6).map(post => ({
    author: post.author?.name || '匿名用户',
    text: (post.content ?? []).map(item => item.text).filter(Boolean).join('\n'),
    images: (post.content ?? []).map(item => item.cdn_src).filter(Boolean) as string[]
  })).filter(comment => comment.text || comment.images.length > 0)

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
    images,
    extras: {
      contentBlocks,
      commentBlocks
    }
  }
}

const threadIdFromUrl = (url: string) => {
  return new URL(url).pathname.match(/\/p\/([A-Za-z0-9]+)/)?.[1]
}

const tiebaApiUrls = (tid: string) => [
  `http://0d00.us.kg:8080/api/tieba/post_detail?tid=${encodeURIComponent(tid)}`,
  `https://api.obfs.dev/api/tieba/post?tid=${encodeURIComponent(tid)}`
]

const normalizeTiebaShareCard = (url: string, shareMeta?: ShareCardMeta): ResolvedPost | undefined => {
  if (!shareMeta) return undefined
  const title = shareMeta.title || '贴吧帖子'
  const description = shareMeta.desc || ''
  const preview = shareMeta.preview
  if (!shareMeta.title && !description && !preview) return undefined

  const contentBlocks: RichContentBlock[] = [
    description ? { type: 'text', text: description } : undefined,
    preview ? { type: 'image', url: preview } : undefined
  ].filter(Boolean) as RichContentBlock[]

  return {
    platform: 'tieba',
    displayName: '贴吧',
    title,
    description,
    pageUrl: shareMeta.jumpUrl || url,
    videos: [],
    images: preview ? [preview] : [],
    extras: {
      coverUrl: preview,
      tags: shareMeta.tag ? [shareMeta.tag] : [],
      contentBlocks
    }
  }
}

export const resolveTieba = async (url: string, generalApis: string[], shareMeta?: ShareCardMeta): Promise<ResolverResult> => {
  const tid = threadIdFromUrl(url)
  if (tid) {
    for (const api of tiebaApiUrls(tid)) {
      try {
        const data = await fetchJson(api)
        if ((data as { post_list?: unknown }).post_list) {
          const hibiResult = normalizeHibiTiebaPost(url, data)
          if (!('ok' in hibiResult)) return hibiResult
        }
        const result = normalizeTiebaPost(url, data)
        if (!('ok' in result)) return result
      } catch {
        // Try the next structured API before falling back to HTML/general parsers.
      }
    }

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

  const shareResult = normalizeTiebaShareCard(url, shareMeta)
  if (shareResult) return shareResult

  return resolveByGeneralApis('贴吧', url, generalApis)
}
