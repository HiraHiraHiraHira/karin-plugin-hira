import crypto from 'node:crypto'

import { fetchJson } from '@/services/http'

import type { ResolvedPost, ResolverFailure, ResolverResult } from './types'

export type XiaoheiheTargetType = 'bbs' | 'pc' | 'console' | 'mobile'

export type XiaoheiheTarget = {
  type: XiaoheiheTargetType
  id: string
}

type BuildRequestOptions = {
  timestamp?: number
  nonce?: string
}

type XiaoheiheApiRequest = {
  url: string
  params: Record<string, string | number>
}

const salt = 'AB45STUVWZEFGJ6CH01D237IXYPQRKLMN89'

const apiUrls: Record<XiaoheiheTargetType, string> = {
  bbs: 'https://api.xiaoheihe.cn/bbs/app/link/tree',
  pc: 'https://api.xiaoheihe.cn/game/get_game_detail',
  console: 'https://api.xiaoheihe.cn/game/console/get_game_detail',
  mobile: 'https://api.xiaoheihe.cn/game/mobile/get_game_detail'
}

const apiPaths: Record<XiaoheiheTargetType, string> = {
  bbs: 'bbs/app/link/tree',
  pc: 'game/get_game_detail',
  console: 'game/console/get_game_detail',
  mobile: 'game/mobile/get_game_detail'
}

const md5 = (data: string) => crypto.createHash('md5').update(data).digest('hex')

const da = (value: number) => (128 & value ? 255 & (value << 1 ^ 27) : value << 1)
const ba = (value: number) => da(value) ^ value
const na = (value: number) => ba(da(value))
const fa = (value: number) => na(ba(da(value)))
const ua = (value: number) => fa(value) ^ na(value) ^ ba(value)

const za = (value: string, key: string, length: number) => {
  let result = ''
  const slice = key.slice(0, length)
  for (const char of value) result += slice[char.charCodeAt(0) % slice.length]
  return result
}

const wa = (value: string, key: string) => {
  let result = ''
  for (const char of value) result += key[char.charCodeAt(0) % key.length]
  return result
}

const interleave = (items: string[]) => {
  let result = ''
  const max = Math.max(...items.map(item => item.length))
  for (let i = 0; i < max; i++) {
    for (const item of items) {
      if (i < item.length) result += item[i]
    }
  }
  return result
}

const buildHkey = (path: string, timestamp: number, nonce: string) => {
  const normalizedPath = `/${path.split('/').filter(Boolean).join('/')}/`
  const seed = interleave([
    za(String(timestamp), salt, -2),
    wa(normalizedPath, salt),
    wa(nonce, salt)
  ]).slice(0, 20)

  const hash = md5(seed)
  const chars = hash.slice(-6).split('').map(char => char.charCodeAt(0))
  const mixed = [
    ua(chars[0]) ^ fa(chars[1]) ^ na(chars[2]) ^ ba(chars[3]),
    ba(chars[0]) ^ ua(chars[1]) ^ fa(chars[2]) ^ na(chars[3]),
    na(chars[0]) ^ ba(chars[1]) ^ ua(chars[2]) ^ fa(chars[3]),
    fa(chars[0]) ^ na(chars[1]) ^ ba(chars[2]) ^ ua(chars[3])
  ]
  const suffix = String(mixed.reduce((sum, value) => sum + value, 0) % 100).padStart(2, '0')

  return `${za(hash.substring(0, 5), salt, -4)}${suffix}`
}

const queryParam = (url: URL, key: string) => url.searchParams.get(key) || undefined

export const extractXiaoheiheTarget = (input: string): XiaoheiheTarget | undefined => {
  let url: URL
  try {
    url = new URL(input)
  } catch {
    return undefined
  }

  const path = url.pathname
  const shareGameType = queryParam(url, 'game_type') as XiaoheiheTargetType | undefined
  const shareAppId = queryParam(url, 'appid')
  if (shareAppId && (shareGameType === 'pc' || shareGameType === 'console' || shareGameType === 'mobile')) {
    return { type: shareGameType, id: shareAppId }
  }

  const shareLinkId = queryParam(url, 'link_id')
  if (shareLinkId) return { type: 'bbs', id: shareLinkId }

  const bbs = path.match(/\/(?:app\/)?bbs\/link\/([a-zA-Z0-9]+)/)
  if (bbs?.[1]) return { type: 'bbs', id: bbs[1] }

  const game = path.match(/\/(?:app\/topic\/)?game\/(pc|console|mobile)\/([a-zA-Z0-9]+)/)
  if (game?.[1] && game[2]) return { type: game[1] as XiaoheiheTargetType, id: game[2] }

  return undefined
}

export const buildXiaoheiheApiRequest = (
  type: XiaoheiheTargetType,
  id: string,
  options: BuildRequestOptions = {}
): XiaoheiheApiRequest => {
  const timestamp = options.timestamp ?? Math.trunc(Date.now() / 1000)
  const nonce = options.nonce ?? md5(`${timestamp}${Math.random()}`).toUpperCase()
  const path = apiPaths[type]
  const baseParams: Record<string, string | number> = {
    os_type: 'web',
    version: '999.0.4',
    hkey: buildHkey(path, timestamp + 1, nonce),
    _time: timestamp,
    nonce
  }

  if (type === 'bbs') {
    return {
      url: apiUrls.bbs,
      params: {
        ...baseParams,
        link_id: id,
        limit: 20,
        web_version: '2.5',
        x_client_type: 'web',
        x_app: 'heybox_website',
        x_os_type: 'Android'
      }
    }
  }

  return {
    url: apiUrls[type],
    params: {
      ...baseParams,
      [type === 'pc' ? 'steam_appid' : 'appid']: id
    }
  }
}

export const optimizeXiaoheiheImageUrl = (url: string | undefined) => {
  if (!url) return url
  return url.includes('?') && !url.endsWith('\\') ? `${url}\\` : url
}

const asObject = (value: unknown): Record<string, any> | undefined => {
  return typeof value === 'object' && value !== null ? value as Record<string, any> : undefined
}

const stripHtml = (html: string) => {
  return html
    .replace(/<a[^>]*?href="([^"]*?)"[^>]*?>(.*?)<\/a>/g, (_match, href: string, text: string) => {
      const cleanText = text.replace(/<[^>]+>/g, '').trim()
      const cleanHref = href.replace(/\\/g, '')
      if (!cleanText) return ''
      return cleanHref.startsWith('http') ? `『${cleanText}』 (${cleanHref})` : `『${cleanText}』`
    })
    .replace(/<span[^>]*?data-emoji="([^"]*?)"[^>]*?>.*?<\/span>/g, (_match, emoji: string) => `[${emoji}]`)
    .replace(/<\/p>|<\/h[1-6]>|<\/blockquote>|<br\s*\/?>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

const pushUnique = (items: string[], value: string | undefined) => {
  const clean = optimizeXiaoheiheImageUrl(value)
  if (clean && !items.includes(clean)) items.push(clean)
}

const parseTextEntities = (linkText: unknown) => {
  const texts: string[] = []
  const images: string[] = []

  if (typeof linkText !== 'string' || !/^\s*[\[{]/.test(linkText)) {
    return { texts, images }
  }

  try {
    const entities = JSON.parse(linkText)
    const list = Array.isArray(entities) ? entities : [entities]

    for (const entity of list) {
      if (!entity || typeof entity !== 'object') continue

      if (entity.type === 'text' && entity.text) {
        texts.push(String(entity.text).trim())
      }

      if (entity.type === 'img' && entity.url) {
        pushUnique(images, String(entity.url))
      }

      if (entity.type === 'html' && entity.text) {
        const html = String(entity.text)
        const imageMatches = html.matchAll(/<img[^>]+data-original="([^"]+)"/g)
        for (const match of imageMatches) pushUnique(images, match[1])

        const textOnly = stripHtml(html.replace(/<img[^>]*>/g, '\n'))
        if (textOnly) texts.push(textOnly)
      }
    }
  } catch {
    return { texts, images }
  }

  return { texts, images }
}

const normalizeComment = (comment: any) => {
  const user = comment.user?.username || '匿名用户'
  const location = comment.ip_location ? ` · ${comment.ip_location}` : ''
  const text = stripHtml(String(comment.text || ''))
  const floor = comment.floor_num ? `${comment.floor_num}楼 ` : ''
  return `${floor}${user}${location}\n${text}`.trim()
}

const failure = (reason: string): ResolverFailure => ({
  platform: 'xiaoheihe',
  displayName: '小黑盒',
  ok: false,
  reason
})

export const normalizeXiaoheihePost = (pageUrl: string, payload: unknown): ResolvedPost | ResolverFailure => {
  const root = asObject(payload)
  const result = asObject(root?.result)
  const link = asObject(result?.link)

  if (root?.status !== 'ok' || !link) return failure('小黑盒 API 返回异常')

  const images: string[] = []
  pushUnique(images, link.thumb)
  pushUnique(images, link.video_thumb)

  const textEntities = parseTextEntities(link.text)
  for (const image of textEntities.images) pushUnique(images, image)

  const tags = Array.isArray(link.hashtags)
    ? link.hashtags.map((tag: any) => tag.name).filter(Boolean)
    : Array.isArray(link.content_tags)
      ? link.content_tags.map((tag: any) => tag.text).filter(Boolean)
      : []

  const comments: string[] = []
  const commentThreads = Array.isArray(result?.comments) ? result.comments : []
  if (commentThreads.length > 0) {
    for (const thread of commentThreads.slice(0, 5)) {
      const threadComments = Array.isArray(thread.comment) ? thread.comment : []
      for (const comment of threadComments.slice(0, 2)) {
        const normalized = normalizeComment(comment)
        if (normalized) comments.push(normalized)
        for (const image of comment.imgs ?? []) pushUnique(images, image.url)
      }
    }
  }

  const descriptionParts = [
    link.description,
    tags.length > 0 ? tags.slice(0, 10).map((tag: string) => `#${tag}`).join(' ') : '',
    ...textEntities.texts,
    comments.length > 0 ? `热门评论\n${comments.join('\n\n')}` : ''
  ].map(part => String(part || '').trim()).filter(Boolean)

  return {
    platform: 'xiaoheihe',
    displayName: '小黑盒帖子',
    title: link.title || '小黑盒帖子',
    description: descriptionParts.join('\n\n'),
    author: link.user?.username,
    pageUrl,
    videos: link.has_video === 1 && link.video_url ? [link.video_url] : [],
    images
  }
}

export const normalizeXiaoheiheGame = (pageUrl: string, type: XiaoheiheTargetType, payload: unknown): ResolvedPost | ResolverFailure => {
  const root = asObject(payload)
  const result = asObject(root?.result)
  const game = asObject(result?.game) ?? asObject(result?.detail) ?? result
  if (root?.status !== 'ok' || !game) return failure('小黑盒游戏 API 返回异常')

  const name = game.name || game.game_name || game.title || '小黑盒游戏'
  const score = game.score ?? game.rating ?? game.heybox_score
  const price = game.price ?? game.current_price
  const platforms = Array.isArray(game.platforms)
    ? game.platforms.join(' / ')
    : game.platform || (type === 'pc' ? 'PC' : type)
  const description = [
    game.desc || game.description || game.intro,
    score !== undefined ? `评分：${score}` : '',
    price !== undefined ? `价格：${price}` : '',
    platforms ? `平台：${platforms}` : ''
  ].map(item => String(item || '').trim()).filter(Boolean).join('\n')

  return {
    platform: 'xiaoheihe',
    displayName: '小黑盒游戏',
    title: String(name),
    description,
    pageUrl,
    videos: [],
    images: [game.cover || game.image || game.header_image || game.icon].filter(Boolean)
  }
}

const toQueryString = (params: Record<string, string | number>) => {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) search.set(key, String(value))
  return search.toString()
}

export const resolveXiaoheihe = async (url: string, cookie = ''): Promise<ResolverResult> => {
  if (!cookie) return failure('需要在 resolver.yaml 配置 xiaoheihe Cookie')

  const target = extractXiaoheiheTarget(url)
  if (!target) return failure('无法识别小黑盒链接类型')

  const request = buildXiaoheiheApiRequest(target.type, target.id)
  const payload = await fetchJson(`${request.url}?${toQueryString(request.params)}`, {
    headers: {
      Cookie: cookie
    }
  })

  if (target.type !== 'bbs') return normalizeXiaoheiheGame(url, target.type, payload)
  return normalizeXiaoheihePost(url, payload)
}
