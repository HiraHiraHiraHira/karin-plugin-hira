import { fetchResolverJson, fetchResolverText } from '@/services/resolverHttp'

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

/** 微博评论接口的 like_count / total_number 常是字符串或缺失，统一成数字，缺失返回 undefined 让渲染层跳过。 */
const commentCount = (value: unknown) => {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) return Number.parseInt(value.trim(), 10)
  return undefined
}

const formatCommentTime = (value: unknown) => {
  const text = typeof value === 'string' ? value.trim() : ''
  if (!text) return undefined
  const date = new Date(text)
  if (Number.isNaN(date.getTime())) return text
  const pad = (part: number) => String(part).padStart(2, '0')
  return `${String(date.getFullYear()).slice(2)}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** R 插件取 hotflow 前 20 条并展示点赞数、时间和来源；这里同样保留三条元数据，交给发送侧渲染。 */
export const normalizeWeiboComments = (payload: unknown): RichCommentBlock[] => {
  const root = payload as { data?: { data?: Array<Record<string, any>> } }
  return (root.data?.data ?? []).slice(0, 20).flatMap(comment => {
    const text = stripHtml(String(comment.text || ''))
    if (!text) return []
    const block: RichCommentBlock = {
      author: comment.user?.screen_name || '匿名用户',
      text,
      images: []
    }
    const likeCount = commentCount(comment.like_count)
    if (likeCount !== undefined) block.likeCount = likeCount
    const replyCount = commentCount(comment.total_number)
    if (replyCount !== undefined) block.replyCount = replyCount
    const time = formatCommentTime(comment.created_at)
    if (time) block.time = time
    const source = firstString(comment.source)
    if (source) block.location = source
    return [block]
  })
}

/** 卡片摘要里最多列 10 条评论；完整 20 条仍通过 commentBlocks 由发送侧单独转发。 */
const MAX_INLINE_COMMENT_LINES = 10

const weiboCommentLines = (comments: RichCommentBlock[]) => comments.slice(0, MAX_INLINE_COMMENT_LINES).map(comment => {
  const like = comment.likeCount ? ` (👍${comment.likeCount})` : ''
  return `${comment.author}：${comment.text}${like}`
})

export const normalizeWeiboStatus = (url: string, status: Record<string, any>, comments: RichCommentBlock[] = []): ResolvedPost => {
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
  // 头条文章类微博的正文只有「发布了头条文章」，真正的标题在 status_title 里，R 插件单独展示这一行。
  const statusTitle = firstString(status.status_title) || ''
  const retweetedText = statusText(retweetedStatus)
  const retweetedAuthor = retweetedStatus?.user?.screen_name
  const retweetedLine = retweetedStatus
    ? `转发 @${retweetedAuthor || '原微博'}${retweetedText ? `：${retweetedText}` : ''}`
    : ''
  const meta = [status.source, status.region_name].filter(Boolean).join('\t')
  const description = [
    text,
    statusTitle,
    retweetedLine,
    meta,
    comments.length > 0 ? `热门评论\n${weiboCommentLines(comments).join('\n')}` : ''
  ].filter(Boolean).join('\n\n')
  const contentBlocks: RichContentBlock[] = [
    text ? { type: 'text', text } : undefined,
    statusTitle && statusTitle !== text ? { type: 'text', text: statusTitle } : undefined,
    retweetedLine ? { type: 'text', text: retweetedLine } : undefined,
    ...pics.map(url => ({ type: 'image' as const, url }))
  ].filter(Boolean) as RichContentBlock[]
  const extras: ResolvedPost['extras'] = {
    contentBlocks,
    commentBlocks: comments
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
    title: statusTitle || text.slice(0, 60),
    description,
    author: status.user?.screen_name,
    pageUrl,
    videos: video ? [{ url: video }] : [],
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
    const payload = await fetchResolverJson<{ data?: { longTextContent?: string } }>(`https://m.weibo.cn/statuses/extend?id=${encodeURIComponent(id)}`, {
      headers: { ...headers, 'X-Requested-With': 'XMLHttpRequest' }
    })
    const longTextContent = payload.data?.longTextContent
    return longTextContent ? { ...status, longTextContent } : status
  } catch {
    return status
  }
}

const voteImagePattern = /https?:\/\/wx\d\.sinaimg\.cn\/[a-z0-9]+\/[^"'\s]+?\.jpg/gi

/** 投票帖正文没有图片，只有桌面版页面的 HTML 里才有选项图；R 插件同样从这里兜底。 */
export const extractWeiboVoteImages = (html: string) => {
  const images: string[] = []
  for (const match of html.matchAll(voteImagePattern)) {
    const url = match[0]
    if (!/\/(?:bmiddle|large|mw2000|orj\d*)\//.test(url)) continue
    // mw2000/orj 需要登录，统一换成可匿名访问的 large。
    const normalized = url.replace(/\/bmiddle\//, '/large/').replace(/\/mw2000\//, '/large/').replace(/\/orj\d*\//, '/large/')
    if (!images.includes(normalized)) images.push(normalized)
    if (images.length >= 10) break
  }
  return images
}

/** 桌面版页面拿不到时再退回 ajax 接口，只从返回的 JSON 文本里捞 sinaimg 大图。 */
const fetchWeiboVoteImages = async (uid: string, id: string, headers: Record<string, string>) => {
  if (uid) {
    try {
      const html = await fetchResolverText(`https://weibo.com/${encodeURIComponent(uid)}/${encodeURIComponent(id)}`, { headers })
      const images = extractWeiboVoteImages(html)
      if (images.length > 0) return images
    } catch {
      // 继续尝试 ajax 接口。
    }
  }

  try {
    const payload = await fetchResolverJson(`https://weibo.com/ajax/statuses/show?id=${encodeURIComponent(id)}`, { headers })
    return extractWeiboVoteImages(JSON.stringify(payload).replace(/\\\//g, '/'))
  } catch {
    return []
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
      const html = await fetchResolverText(`https://m.weibo.cn/detail/${encodeURIComponent(id)}`, { headers })
      status = extractWeiboStatusFromDetailHtml(html)
    } catch {
      status = undefined
    }

    if (!status) {
      const data = await fetchResolverJson<{ data?: Record<string, any> }>(`https://m.weibo.cn/statuses/show?id=${encodeURIComponent(id)}`, {
        headers: { ...headers, 'X-Requested-With': 'XMLHttpRequest' }
      })
      status = data.data
    }
    if (!status) throw new Error('微博接口没有返回数据')
    const requestId = weiboStatusRequestId(status, id)
    status = await enrichWeiboLongText(requestId, status, headers)

    let comments: RichCommentBlock[] = []
    try {
      const commentData = await fetchResolverJson(`https://m.weibo.cn/comments/hotflow?id=${encodeURIComponent(requestId)}&mid=${encodeURIComponent(requestId)}&max_id_type=0`, {
        headers: { ...headers, 'X-Requested-With': 'XMLHttpRequest' }
      })
      comments = normalizeWeiboComments(commentData)
    } catch {
      comments = []
    }

    const result = normalizeWeiboStatus(url, status, comments)
    // 投票帖既没图也没视频时，从桌面版页面/接口兜底取选项图（R tools.js 的投票图片分支）。
    if (result.images.length === 0 && result.videos.length === 0) {
      const uid = String(status.user?.id || status.user?.idstr || '')
      const voteImages = await fetchWeiboVoteImages(uid, requestId, headers)
      if (voteImages.length > 0) {
        result.images = voteImages
        result.extras = {
          ...result.extras,
          contentBlocks: [
            ...(result.extras?.contentBlocks ?? []),
            ...voteImages.map(image => ({ type: 'image' as const, url: image }))
          ]
        }
      }
    }

    return result
  } catch {
    // 接口失败时只能退回页面标题；页面也拿不到就明确报错，不要发一条空卡片冒充解析成功。
    try {
      const html = await fetchResolverText(`https://m.weibo.cn/detail/${encodeURIComponent(id)}`, { headers })
      const title = stripHtml(html.match(/<title>(.*?)<\/title>/i)?.[1] || '')
      if (title && title !== '微博') {
        return {
          platform: 'weibo',
          displayName: '微博',
          title,
          pageUrl: url,
          videos: [],
          images: []
        }
      }
    } catch {
      // Fall through to the explicit failure below.
    }

    return {
      platform: 'weibo',
      displayName: '微博',
      ok: false,
      reason: cookie ? '微博页面和接口都没有返回内容，Cookie 可能已失效' : '微博页面和接口都没有返回内容，可尝试配置 resolver.cookies.weibo'
    }
  }
}
