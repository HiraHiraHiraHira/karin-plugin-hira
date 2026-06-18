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

const imgTagRegExp = /<img\b[^>]*src=["']([^"']+)["'][^>]*>/g

const imagesFromHtml = (html: string) => [...html.matchAll(imgTagRegExp)].map(match => match[1])

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

const pushUnique = (items: string[], value: unknown) => {
  const text = firstString(value)
  if (text && !items.includes(text)) items.push(text)
}

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

const appendImageBlocks = (blocks: RichContentBlock[], images: unknown[]) => {
  const known = new Set(blocks.filter(block => block.type === 'image').map(block => block.url))
  for (const image of images) {
    const url = firstString(image)
    if (url && !known.has(url)) {
      blocks.push({ type: 'image', url })
      known.add(url)
    }
  }
  return blocks
}

const postAuthorName = (post: Record<string, any> | undefined) => firstString(
  post?.author?.name,
  post?.author?.nickname,
  post?.author?.user_name,
  post?.user?.name,
  post?.user?.nickname,
  post?.user_name,
  post?.username,
  post?.name
) || '匿名用户'

const postFloor = (post: Record<string, any> | undefined) => firstNumber(
  post?.floor,
  post?.floor_no,
  post?.floorNum,
  post?.floor_num,
  post?.post_no,
  post?.postNo,
  post?.index
)

const postLocation = (post: Record<string, any> | undefined) => firstString(
  post?.location,
  post?.ip_location,
  post?.ipLocation,
  post?.ip
)

const postTime = (post: Record<string, any> | undefined) => firstString(
  post?.time,
  post?.create_time,
  post?.created_at,
  post?.createAt,
  post?.date
)

const postReplyTo = (post: Record<string, any> | undefined) => firstString(
  post?.replyTo,
  post?.reply_to,
  post?.quote_user_name,
  post?.quoteUserName,
  post?.reply_user?.name,
  post?.replyUser?.name
)

const forumName = (root: Record<string, any>, top?: Record<string, any>) => firstString(
  root.forum?.name,
  root.forum_name,
  root.thread?.forum?.name,
  root.thread?.forum_name,
  top?.forum?.name,
  top?.forum_name
)

const postImages = (post: Record<string, any> | undefined) => {
  const images: string[] = []
  if (!post) return images
  for (const image of imagesFromHtml(firstString(post.content) || '')) pushUnique(images, image)
  for (const image of Array.isArray(post.images) ? post.images : []) pushUnique(images, image)
  for (const image of Array.isArray(post.imgs) ? post.imgs : []) pushUnique(images, image)
  return images
}

const contentItemImage = (item: Record<string, any>) => firstString(
  item.cdn_src,
  item.src,
  item.url,
  item.image,
  item.origin_src,
  item.originSrc
)

const contentItemVideo = (item: Record<string, any>) => firstString(item.link, item.video, item.video_url, item.videoUrl)

const failure = (reason: string): ResolverFailure => ({
  platform: 'tieba',
  displayName: '贴吧',
  ok: false,
  reason
})

export const normalizeTiebaPost = (url: string, payload: unknown): ResolvedPost | ResolverFailure => {
  const root = payload as {
    forum?: { name?: string }
    forum_name?: string
    thread?: {
      title?: string
      author?: { name?: string }
      content?: string
      images?: string[]
    }
    posts?: Array<Record<string, any>>
  }
  const thread = root.thread
  if (!thread) return failure('贴吧接口返回异常')
  const rootObject = root as Record<string, any>
  const threadObject = thread as Record<string, any>
  const posts = root.posts ?? []

  const images = [
    ...imagesFromHtml(thread.content || ''),
    ...(thread.images ?? []),
    ...posts.flatMap(post => postImages(post))
  ].filter(Boolean)

  const comments = posts.slice(0, 5).map(post => {
    const author = postAuthorName(post)
    const text = stripHtml(post.content || '')
    return text ? `${author}：${text}` : ''
  }).filter(Boolean)
  const contentBlocks = dedupeContentBlocks(appendImageBlocks(htmlContentBlocks(thread.content || ''), thread.images ?? []))
  const commentBlocks: RichCommentBlock[] = posts.slice(0, 5).map(post => ({
    author: postAuthorName(post),
    replyTo: postReplyTo(post),
    floor: postFloor(post),
    location: postLocation(post),
    time: postTime(post),
    text: stripHtml(post.content || ''),
    images: postImages(post)
  })).filter(comment => comment.text || comment.images.length > 0)
  const dedupedImages = [...new Set(images)]
  const tag = forumName(rootObject, threadObject)

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
    images: dedupedImages,
    extras: {
      coverUrl: dedupedImages[0],
      tags: tag ? [tag] : [],
      contentBlocks,
      commentBlocks
    }
  }
}

export const normalizeHibiTiebaPost = (url: string, payload: unknown): ResolvedPost | ResolverFailure => {
  const root = payload as {
    forum?: { name?: string }
    forum_name?: string
    post_list?: Array<{
      title?: string
      author?: { name?: string, nickname?: string }
      content?: Array<Record<string, any>>
    }>
  }
  const posts = root.post_list ?? []
  const top = posts[0]
  if (!top) return failure('贴吧接口返回异常')
  const rootObject = root as Record<string, any>

  const images: string[] = []
  const videos: string[] = []

  const normalizeContent = (content: Array<Record<string, any>> = []) => {
    const texts: string[] = []
    for (const item of content) {
      if (item.text) texts.push(item.text)
      pushUnique(images, contentItemImage(item))
      pushUnique(videos, contentItemVideo(item))
    }
    return texts.join('\n')
  }

  const normalizeBlocks = (content: Array<Record<string, any>> = []) => {
    const blocks: RichContentBlock[] = []
    for (const item of content) {
      if (item.text) blocks.push({ type: 'text', text: item.text })
      const image = contentItemImage(item)
      if (image) blocks.push({ type: 'image', url: image })
    }
    return dedupeContentBlocks(blocks)
  }

  const hibiPostImages = (post: Record<string, any>) => {
    const urls: string[] = []
    for (const item of Array.isArray(post.content) ? post.content : []) pushUnique(urls, contentItemImage(item))
    return urls
  }

  const topText = normalizeContent(top.content)
  const comments = posts.slice(1, 6).map(post => normalizeContent(post.content)).filter(Boolean)
  const contentBlocks = normalizeBlocks(top.content)
  const commentBlocks: RichCommentBlock[] = posts.slice(1, 6).map(post => ({
    author: postAuthorName(post as Record<string, any>),
    replyTo: postReplyTo(post as Record<string, any>),
    floor: postFloor(post as Record<string, any>),
    location: postLocation(post as Record<string, any>),
    time: postTime(post as Record<string, any>),
    text: (post.content ?? []).map(item => item.text).filter(Boolean).join('\n'),
    images: hibiPostImages(post as Record<string, any>)
  })).filter(comment => comment.text || comment.images.length > 0)
  const tag = forumName(rootObject, top as Record<string, any>)

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
      coverUrl: images[0],
      tags: tag ? [tag] : [],
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
