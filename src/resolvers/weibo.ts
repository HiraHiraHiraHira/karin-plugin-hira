import { fetchJson, fetchText } from '@/services/http'

import type { ResolvedPost, ResolverResult, RichCommentBlock, RichContentBlock } from './types'

const alphabet = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'

const base62Encode = (value: number) => {
  if (value === 0) return '0'

  let number = value
  let result = ''
  while (number > 0) {
    result = alphabet[number % 62] + result
    number = Math.floor(number / 62)
  }

  return result
}

const mid2id = (mid: string) => {
  const reversed = mid.toString().split('').reverse().join('')
  const size = Math.ceil(reversed.length / 7)
  const chunks: string[] = []

  for (let i = 0; i < size; i++) {
    const slice = reversed.slice(i * 7, (i + 1) * 7).split('').reverse().join('')
    let encoded = base62Encode(Number.parseInt(slice, 10))
    if (i < size - 1 && encoded.length < 4) encoded = '0'.repeat(4 - encoded.length) + encoded
    chunks.push(encoded)
  }

  return chunks.reverse().join('')
}

export const extractWeiboId = (input: string) => {
  let parsed: URL
  try {
    parsed = new URL(input)
  } catch {
    return undefined
  }

  const path = parsed.pathname
  const hostname = parsed.hostname.toLowerCase()

  if (hostname === 'm.weibo.cn' || hostname.endsWith('.m.weibo.cn')) {
    return path.match(/\/(?:detail|status)\/([A-Za-z0-9]+)/)?.[1]
      || path.match(/\/[A-Za-z0-9]+\/([A-Za-z0-9]+)/)?.[1]
  }

  const mid = parsed.searchParams.get('mid')
  if (hostname === 'weibo.com' || hostname.endsWith('.weibo.com')) {
    if (path.includes('/tv/show') && mid) return /^\d+$/.test(mid) ? mid2id(mid) : mid
    return path.match(/\/[A-Za-z0-9]+\/([A-Za-z0-9]+)/)?.[1]
  }

  return undefined
}

const stripHtml = (text: string) => text
  .replace(/<br\s*\/?>/gi, '\n')
  .replace(/<[^>]+>/g, '')
  .replace(/&nbsp;/g, ' ')
  .replace(/&amp;/g, '&')
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>')
  .replace(/&#39;/g, '\'')
  .replace(/&quot;/g, '"')
  .trim()

const asObject = (value: unknown): Record<string, any> | undefined => {
  return typeof value === 'object' && value !== null ? value as Record<string, any> : undefined
}

const firstString = (...values: unknown[]) => {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return undefined
}

const pushUnique = (items: string[], value: unknown) => {
  const url = firstString(value)
  if (url && !items.includes(url)) items.push(url)
}

const statusText = (status: Record<string, any> | undefined) => {
  if (!status) return ''
  return stripHtml(firstString(
    status.longTextContent,
    status.long_text?.longTextContent,
    status.longText?.longTextContent,
    status.text
  ) || '')
}

const weiboPicUrls = (status: Record<string, any> | undefined) => {
  const images: string[] = []
  if (!status) return images

  for (const pic of Array.isArray(status.pics) ? status.pics : []) {
    pushUnique(images, pic?.large?.url || pic?.largest?.url || pic?.bmiddle?.url || pic?.url)
  }

  const picInfos = asObject(status.pic_infos)
  for (const pic of Object.values(picInfos || {})) {
    const item = asObject(pic)
    pushUnique(images, item?.largest?.url || item?.large?.url || item?.bmiddle?.url || item?.thumbnail?.url)
  }

  return images
}

const weiboCoverUrl = (status: Record<string, any> | undefined) => {
  if (!status) return undefined
  const pageInfo = asObject(status.page_info)
  const mediaInfo = asObject(pageInfo?.media_info)
  return firstString(
    pageInfo?.page_pic?.url,
    pageInfo?.pic_info?.pic_big?.url,
    pageInfo?.pic_info?.pic_middle?.url,
    mediaInfo?.cover_image,
    mediaInfo?.cover_image_phone,
    mediaInfo?.poster,
    mediaInfo?.image
  )
}

const weiboVideoUrl = (status: Record<string, any> | undefined) => {
  if (!status) return undefined
  const pageInfo = asObject(status.page_info)
  const media = asObject(pageInfo?.media_info)
  const videoUrls = asObject(pageInfo?.urls)
  return firstString(
    media?.stream_url_hd,
    media?.stream_url,
    media?.mp4_hd_url,
    media?.mp4_sd_url,
    videoUrls?.mp4_720p_mp4,
    videoUrls?.mp4_hd_mp4,
    videoUrls?.mp4_ld_mp4
  )
}

const weiboAuthorAvatar = (status: Record<string, any>) => firstString(
  status.user?.avatar_hd,
  status.user?.avatar_large,
  status.user?.profile_image_url
)

const weiboStatusRequestId = (status: Record<string, any>, fallback: string) => firstString(
  status.idstr,
  typeof status.id === 'number' ? String(status.id) : status.id,
  typeof status.mid === 'number' ? String(status.mid) : status.mid,
  fallback
) || fallback

const parseJsonObjectFrom = (text: string, start: number) => {
  const open = text.indexOf('{', start)
  if (open < 0) return undefined

  let depth = 0
  let inString = false
  let escaped = false
  for (let index = open; index < text.length; index++) {
    const char = text[index]
    if (inString) {
      if (escaped) {
        escaped = false
      } else if (char === '\\') {
        escaped = true
      } else if (char === '"') {
        inString = false
      }
      continue
    }

    if (char === '"') {
      inString = true
      continue
    }
    if (char === '{') depth++
    if (char === '}') depth--
    if (depth === 0) {
      try {
        return JSON.parse(text.slice(open, index + 1)) as Record<string, any>
      } catch {
        return undefined
      }
    }
  }

  return undefined
}

export const extractWeiboStatusFromDetailHtml = (html: string) => {
  const statusKey = html.search(/"status"\s*:/)
  if (statusKey < 0) return undefined
  const colon = html.indexOf(':', statusKey)
  return parseJsonObjectFrom(html, colon + 1)
}

export const normalizeWeiboComments = (payload: unknown) => {
  const root = payload as { data?: { data?: Array<{ user?: { screen_name?: string }, text?: string }> } }
  return (root.data?.data ?? []).slice(0, 5).map(comment => {
    const user = comment.user?.screen_name || '匿名用户'
    const text = stripHtml(comment.text || '')
    return text ? `${user}：${text}` : ''
  }).filter(Boolean)
}

const weiboCommentBlocks = (comments: string[]): RichCommentBlock[] => comments.map(comment => {
  const separator = comment.indexOf('：')
  if (separator <= 0) return { author: '匿名用户', text: comment, images: [] }
  return {
    author: comment.slice(0, separator),
    text: comment.slice(separator + 1),
    images: []
  }
}).filter(comment => comment.text)

export const normalizeWeiboStatus = (url: string, status: Record<string, any>, comments: string[] = []): ResolvedPost => {
  const retweetedStatus = asObject(status.retweeted_status)
  const pics = [
    ...weiboPicUrls(status),
    ...weiboPicUrls(retweetedStatus)
  ]
  const coverUrl = weiboCoverUrl(status) || weiboCoverUrl(retweetedStatus)
  if (coverUrl) pushUnique(pics, coverUrl)
  const pageUrl = status.bid ? `https://weibo.com/${status.user?.id || ''}/${status.bid}` : url
  const video = weiboVideoUrl(status) || weiboVideoUrl(retweetedStatus)
  const text = statusText(status)
  const retweetedText = statusText(retweetedStatus)
  const retweetedAuthor = retweetedStatus?.user?.screen_name
  const retweetedLine = retweetedStatus
    ? `转发 @${retweetedAuthor || '原微博'}${retweetedText ? `：${retweetedText}` : ''}`
    : ''
  const meta = [status.source, status.region_name].filter(Boolean).join('\t')
  const description = [
    text,
    retweetedLine,
    meta,
    comments.length > 0 ? `热门评论\n${comments.join('\n')}` : ''
  ].filter(Boolean).join('\n\n')
  const contentBlocks: RichContentBlock[] = [
    text ? { type: 'text', text } : undefined,
    retweetedLine ? { type: 'text', text: retweetedLine } : undefined,
    ...pics.map(url => ({ type: 'image' as const, url }))
  ].filter(Boolean) as RichContentBlock[]
  const commentBlocks = weiboCommentBlocks(comments)
  const extras: ResolvedPost['extras'] = {
    contentBlocks,
    commentBlocks
  }
  if (coverUrl) extras.coverUrl = coverUrl
  const authorAvatar = weiboAuthorAvatar(status)
  if (authorAvatar) extras.authorAvatar = authorAvatar
  if (status.region_name) extras.location = String(status.region_name)
  if (status.created_at) extras.createdAt = status.created_at
  if (retweetedStatus) extras.tags = ['转发']

  return {
    platform: 'weibo',
    displayName: '微博',
    title: text.slice(0, 60),
    description,
    author: status.user?.screen_name,
    pageUrl,
    videos: video ? [video] : [],
    images: pics,
    extras
  }
}

const enrichWeiboLongText = async (
  id: string,
  status: Record<string, any>,
  headers: Record<string, string>
) => {
  if (!status.isLongText || status.longTextContent || status.longText?.longTextContent || status.long_text?.longTextContent) return status
  try {
    const payload = await fetchJson<{ data?: { longTextContent?: string } }>(`https://m.weibo.cn/statuses/extend?id=${encodeURIComponent(id)}`, {
      headers: { ...headers, 'X-Requested-With': 'XMLHttpRequest' }
    })
    const longTextContent = payload.data?.longTextContent
    return longTextContent ? { ...status, longTextContent } : status
  } catch {
    return status
  }
}

export const resolveWeibo = async (url: string, cookie = ''): Promise<ResolverResult> => {
  const id = extractWeiboId(url)
  if (!id) return { platform: 'weibo', displayName: '微博', ok: false, reason: '无法识别微博 ID' }

  const headers: Record<string, string> = { Referer: 'https://weibo.com/' }
  if (cookie) headers.Cookie = cookie

  try {
    let status: Record<string, any> | undefined
    try {
      const html = await fetchText(`https://m.weibo.cn/detail/${encodeURIComponent(id)}`, { headers })
      status = extractWeiboStatusFromDetailHtml(html)
    } catch {
      status = undefined
    }

    if (!status) {
      const data = await fetchJson<{ data?: Record<string, any> }>(`https://m.weibo.cn/statuses/show?id=${encodeURIComponent(id)}`, {
        headers: { ...headers, 'X-Requested-With': 'XMLHttpRequest' }
      })
      status = data.data
    }
    if (!status) throw new Error('empty api data')
    const requestId = weiboStatusRequestId(status, id)
    status = await enrichWeiboLongText(requestId, status, headers)

    let comments: string[] = []
    try {
      const commentData = await fetchJson(`https://m.weibo.cn/comments/hotflow?id=${encodeURIComponent(requestId)}&mid=${encodeURIComponent(requestId)}&max_id_type=0`, {
        headers: { ...headers, 'X-Requested-With': 'XMLHttpRequest' }
      })
      comments = normalizeWeiboComments(commentData)
    } catch {
      comments = []
    }

    return normalizeWeiboStatus(url, status, comments)
  } catch {
    const html = await fetchText(`https://m.weibo.cn/detail/${encodeURIComponent(id)}`, { headers })
    const title = stripHtml(html.match(/<title>(.*?)<\/title>/i)?.[1] || '微博')
    return {
      platform: 'weibo',
      displayName: '微博',
      title,
      pageUrl: url,
      videos: [],
      images: []
    }
  }
}
