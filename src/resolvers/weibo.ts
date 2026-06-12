import { fetchJson, fetchText } from '@/services/http'

import type { ResolvedPost, ResolverResult } from './types'

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

const stripHtml = (text: string) => text.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim()

export const normalizeWeiboComments = (payload: unknown) => {
  const root = payload as { data?: { data?: Array<{ user?: { screen_name?: string }, text?: string }> } }
  return (root.data?.data ?? []).slice(0, 5).map(comment => {
    const user = comment.user?.screen_name || '匿名用户'
    const text = stripHtml(comment.text || '')
    return text ? `${user}：${text}` : ''
  }).filter(Boolean)
}

export const normalizeWeiboStatus = (url: string, status: Record<string, any>, comments: string[] = []): ResolvedPost => {
  const pics = Array.isArray(status.pics) ? status.pics.map((pic: any) => pic.large?.url || pic.url).filter(Boolean) : []
  const pageUrl = status.bid ? `https://weibo.com/${status.user?.id || ''}/${status.bid}` : url
  const media = status.page_info?.media_info
  const video = media?.stream_url_hd || media?.stream_url || media?.mp4_hd_url || media?.mp4_sd_url
  const description = [
    stripHtml(status.text || ''),
    comments.length > 0 ? `热门评论\n${comments.join('\n')}` : ''
  ].filter(Boolean).join('\n\n')

  return {
    platform: 'weibo',
    displayName: '微博',
    title: stripHtml(status.text || '').slice(0, 60),
    description,
    author: status.user?.screen_name,
    pageUrl,
    videos: video ? [video] : [],
    images: pics
  }
}

export const resolveWeibo = async (url: string, cookie = ''): Promise<ResolverResult> => {
  const id = extractWeiboId(url)
  if (!id) return { platform: 'weibo', displayName: '微博', ok: false, reason: '无法识别微博 ID' }

  const headers: Record<string, string> = { Referer: 'https://weibo.com/' }
  if (cookie) headers.Cookie = cookie

  try {
    const data = await fetchJson<{ data?: Record<string, any> }>(`https://m.weibo.cn/statuses/show?id=${encodeURIComponent(id)}`, { headers })
    const status = data.data
    if (!status) throw new Error('empty api data')

    let comments: string[] = []
    try {
      const commentData = await fetchJson(`https://m.weibo.cn/comments/hotflow?id=${encodeURIComponent(id)}&mid=${encodeURIComponent(id)}&max_id_type=0`, { headers })
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
