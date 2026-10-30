import crypto from 'node:crypto'

import { fetchResolverJson } from '@/services/resolverHttp'

import type { ResolvedPost, ResolverFailure, ResolverResult, RichCommentBlock, RichContentBlock } from './types'

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
    fa(chars[0]) ^ na(chars[1]) ^ ba(chars[2]) ^ ua(chars[3]),
    chars[4],
    chars[5]
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
      const cleanHref = normalizeHeyboxHref(href.replace(/\\/g, ''))
      if (!cleanText) return ''
      return cleanHref.startsWith('http') ? `『${cleanText}』 (${cleanHref})` : `『${cleanText}』`
    })
    .replace(/<span[^>]*?data-emoji="([^"]*?)"[^>]*?>.*?<\/span>/g, (_match, emoji: string) => `[${emoji}]`)
    .replace(/<\/p>|<\/h[1-6]>|<\/blockquote>|<br\s*\/?>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

const normalizeHeyboxHref = (href: string) => {
  const cleanHref = href.replace(/\\/g, '')
  try {
    const decoded = decodeURIComponent(cleanHref)
    const match = decoded.match(/heybox:\/\/({.*})/)
    if (!match?.[1]) return cleanHref

    const data = JSON.parse(match[1])
    if (data.protocol_type === 'openUser' && data.user_id) {
      return `https://www.xiaoheihe.cn/app/user/profile/${data.user_id}`
    }
    if (data.protocol_type === 'openGameDetail' && data.app_id) {
      return `https://www.xiaoheihe.cn/app/topic/game/${data.game_type || 'pc'}/${data.app_id}`
    }
    if (data.protocol_type === 'openLink' && data.link?.linkid) {
      return `https://www.xiaoheihe.cn/app/bbs/link/${data.link.linkid}`
    }
  } catch {
    return cleanHref
  }

  return cleanHref
}

const pushUnique = (items: string[], value: string | undefined) => {
  const clean = optimizeXiaoheiheImageUrl(value)
  if (clean && !items.includes(clean)) items.push(clean)
}

const pushTextBlock = (blocks: RichContentBlock[], text: string | undefined) => {
  const clean = String(text || '').replace(/\n{3,}/g, '\n\n').trim()
  if (clean) blocks.push({ type: 'text', text: clean })
}

const pushImageBlock = (blocks: RichContentBlock[], images: string[], url: string | undefined) => {
  const clean = optimizeXiaoheiheImageUrl(url)
  if (!clean) return
  blocks.push({ type: 'image', url: clean })
  if (!images.includes(clean)) images.push(clean)
}

const extractIframeUrl = (iframe: string) => {
  const src = iframe.match(/src="([^"]+)"/)?.[1]?.replace(/\\/g, '')
  if (!src) return undefined
  return src.startsWith('//') ? `https:${src}` : src
}

/** 帖子正文里嵌入的游戏卡（R tools.js 3990-4059）：能取到游戏详情就渲染封面+评分+价格，取不到退回链接。 */
export type XiaoheiheGameCard = {
  name?: string
  score?: string
  scoreComment?: number
  price?: string
  cover?: string
}

const renderGameCard = (
  blocks: RichContentBlock[],
  images: string[],
  gameId: string,
  cards: Record<string, XiaoheiheGameCard>
) => {
  const card = cards[gameId]
  if (!card) {
    pushTextBlock(blocks, `相关游戏：https://www.xiaoheihe.cn/app/topic/game/pc/${gameId}`)
    return
  }

  if (card.cover) pushImageBlock(blocks, images, card.cover)
  const lines = [`🎮 ${card.name || '相关游戏'}`]
  lines.push(`🌟 评分: ${card.score || '暂无评分'}${card.scoreComment ? ` (${card.scoreComment}人)` : ''}`)
  lines.push(`💰 价格: ${card.price || '暂无价格'}`)
  pushTextBlock(blocks, lines.join('\n'))
}

const parseHtmlBlocks = (
  html: string,
  images: string[],
  cards: Record<string, XiaoheiheGameCard> = {}
) => {
  const blocks: RichContentBlock[] = []
  const parts = html.split(/(<img\b[^>]*>|<iframe\b[\s\S]*?<\/iframe>)/gi).filter(Boolean)
  let textBuffer = ''

  for (const part of parts) {
    if (/^<img\b/i.test(part)) {
      pushTextBlock(blocks, stripHtml(textBuffer))
      textBuffer = ''

      const gameId = part.match(/data-gameid="(\d+)"/)?.[1]
      const imageUrl = part.match(/data-original="([^"]+)"/)?.[1] || part.match(/src="([^"]+)"/)?.[1]
      if (gameId) {
        renderGameCard(blocks, images, gameId, cards)
      } else {
        pushImageBlock(blocks, images, imageUrl)
      }
      continue
    }

    if (/^<iframe\b/i.test(part)) {
      pushTextBlock(blocks, stripHtml(textBuffer))
      textBuffer = ''
      const iframeUrl = extractIframeUrl(part)
      if (iframeUrl) pushTextBlock(blocks, `(${iframeUrl})`)
      continue
    }

    textBuffer += part
  }

  pushTextBlock(blocks, stripHtml(textBuffer))
  return blocks
}

const parseTextEntities = (linkText: unknown, cards: Record<string, XiaoheiheGameCard> = {}) => {
  const texts: string[] = []
  const images: string[] = []
  const blocks: RichContentBlock[] = []

  if (typeof linkText !== 'string' || !/^\s*[\[{]/.test(linkText)) {
    return { texts, images, blocks }
  }

  try {
    const entities = JSON.parse(linkText)
    const list = Array.isArray(entities) ? entities : [entities]

    for (const entity of list) {
      if (!entity || typeof entity !== 'object') continue

      if (entity.type === 'text' && entity.text) {
        const text = String(entity.text).trim()
        if (text) {
          texts.push(text)
          blocks.push({ type: 'text', text })
        }
      }

      if (entity.type === 'img' && entity.url) {
        pushImageBlock(blocks, images, String(entity.url))
      }

      if (entity.type === 'html' && entity.text) {
        const html = String(entity.text)
        const htmlBlocks = parseHtmlBlocks(html, images, cards)
        blocks.push(...htmlBlocks)
        const textOnly = htmlBlocks
          .filter((block): block is Extract<RichContentBlock, { type: 'text' }> => block.type === 'text')
          .map(block => block.text)
          .join('\n')
          .trim()
        if (textOnly) texts.push(textOnly)
      }
    }
  } catch {
    return { texts, images, blocks }
  }

  return { texts, images, blocks }
}

const commentNumber = (value: unknown) => {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) return Number.parseInt(value.trim(), 10)
  return undefined
}

const normalizeComment = (comment: Record<string, any>) => {
  const user = comment.user?.username || '匿名用户'
  const location = comment.ip_location ? ` · ${comment.ip_location}` : ''
  const text = stripHtml(String(comment.text || ''))
  const floor = comment.floor_num ? `${comment.floor_num}楼 ` : ''
  return `${floor}${user}${location}\n${text}`.trim()
}

const normalizeCommentBlock = (comment: Record<string, any>): RichCommentBlock | undefined => {
  const text = stripHtml(String(comment.text || ''))
  if (!text) return undefined

  const images: string[] = []
  for (const image of Array.isArray(comment.imgs) ? comment.imgs : []) pushUnique(images, image?.url)

  const block: RichCommentBlock = {
    author: comment.user?.username || '匿名用户',
    replyTo: comment.replyuser?.username,
    floor: typeof comment.floor_num === 'number' ? comment.floor_num : undefined,
    location: comment.ip_location || undefined,
    time: comment.create_at ? String(comment.create_at) : undefined,
    text,
    images
  }
  const likeCount = commentNumber(comment.up) ?? commentNumber(comment.like_count) ?? commentNumber(comment.like_num)
  if (likeCount !== undefined) block.likeCount = likeCount
  const replyCount = commentNumber(comment.reply_num) ?? commentNumber(comment.sub_comment_num) ?? commentNumber(comment.comment_num)
  if (replyCount !== undefined) block.replyCount = replyCount
  return block
}

const failure = (reason: string): ResolverFailure => ({
  platform: 'xiaoheihe',
  displayName: '小黑盒',
  ok: false,
  reason
})

export const normalizeXiaoheihePost = (
  pageUrl: string,
  payload: unknown,
  gameCards: Record<string, XiaoheiheGameCard> = {}
): ResolvedPost | ResolverFailure => {
  const root = asObject(payload)
  const result = asObject(root?.result)
  const link = asObject(result?.link)

  if (root?.status !== 'ok' || !link) return failure('小黑盒 API 返回异常')

  const images: string[] = []
  pushUnique(images, link.thumb)
  pushUnique(images, link.video_thumb)

  const textEntities = parseTextEntities(link.text, gameCards)
  for (const image of textEntities.images) pushUnique(images, image)

  const hashtags = objectList(link.hashtags).map(tag => firstString(tag.name)).filter((tag): tag is string => Boolean(tag))
  const contentTags = objectList(link.content_tags).map(tag => firstString(tag.text)).filter((tag): tag is string => Boolean(tag))
  const tags = hashtags.length > 0 ? hashtags : contentTags

  // R 插件把小黑盒线程里的评论全部按楼层排序后取前 50 条（tools.js 4215-4250）。
  const commentThreads = objectList(result?.comments)
  const flatComments = commentThreads.flatMap(thread => objectList(thread.comment))
  flatComments.sort((a, b) => {
    const floorA = commentNumber(a.floor_num) ?? 0
    const floorB = commentNumber(b.floor_num) ?? 0
    return floorA - floorB
  })
  const comments: string[] = []
  const commentBlocks: RichCommentBlock[] = []
  for (const comment of flatComments.slice(0, 50)) {
    // 摘要里最多列 10 条；完整 50 条走 commentBlocks。
    if (comments.length < 10) {
      const normalized = normalizeComment(comment)
      if (normalized) comments.push(normalized)
    }
    const commentBlock = normalizeCommentBlock(comment)
    if (commentBlock) commentBlocks.push(commentBlock)
    for (const image of objectList(comment.imgs)) pushUnique(images, firstString(image.url))
  }

  const descriptionParts = [
    link.description,
    tags.length > 0 ? tags.slice(0, 10).map(tag => `#${tag}`).join(' ') : '',
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
    videos: link.has_video === 1 && link.video_url ? [{ url: String(link.video_url) }] : [],
    images,
    extras: {
      contentBlocks: textEntities.blocks,
      commentBlocks,
      tags,
      coverUrl: optimizeXiaoheiheImageUrl(link.thumb || link.video_thumb),
      authorAvatar: optimizeXiaoheiheImageUrl(link.user?.avatar || link.user?.avatar_url),
      location: link.ip_location || link.location,
      createdAt: link.create_at ? String(link.create_at) : undefined
    }
  }
}

const firstString = (...values: unknown[]) => {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim()
    if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  }
  return undefined
}

const objectList = (value: unknown) => {
  const list = Array.isArray(value) ? value : []
  return list.map(asObject).filter((item): item is Record<string, any> => Boolean(item))
}

const menuValue = (game: Record<string, any>, menuType: string) => {
  const menu = objectList(game.menu_v2)
  return firstString(menu.find(item => item.type === menuType)?.value)
}

const gameDataValue = (list: unknown, desc: string) => {
  const item = objectList(list).find(entry => entry.desc === desc)
  return firstString(item?.value, item?.text)
}

/**
 * `price` 是对象（`{ current, initial, discount, lowest_price }`），直接插值就是 `[object Object]`；
 * PC 取 `price.current`，主机取首个地区价，字符串/数字价格是旧接口残留，保留兼容。
 */
const gamePriceText = (game: Record<string, any>, type: XiaoheiheTargetType) => {
  const price = asObject(game.price)
  const current = firstString(price?.current, game.current_price)
  if (type === 'pc' && current && current !== '0') return `¥${current}`

  const region = Array.isArray(game.region_prices) ? asObject(game.region_prices[0]) : undefined
  const regionAmount = firstString(region?.final_amount)
  if (regionAmount) return `${regionAmount} (${firstString(region?.region_name) || '地区'})`

  if (current) return type === 'pc' ? `¥${current}` : current
  if (typeof game.price === 'string' || typeof game.price === 'number') return String(game.price)
  return undefined
}

/** 帖子正文里 `data-gameid` 的内嵌游戏卡 id（去重，最多 3 个，避免一条帖子打 9 次接口）。 */
export const extractXiaoheiheGameIds = (linkText: unknown) => {
  if (typeof linkText !== 'string' || !/^\s*[\[{]/.test(linkText)) return []
  try {
    const entities = JSON.parse(linkText)
    const list: unknown[] = Array.isArray(entities) ? entities : [entities]
    const ids: string[] = []
    for (const entity of list) {
      const item = asObject(entity)
      if (!item || item.type !== 'html' || typeof item.text !== 'string') continue
      for (const match of item.text.matchAll(/data-gameid="(\d+)"/g)) {
        if (match[1] && !ids.includes(match[1])) ids.push(match[1])
        if (ids.length >= 3) return ids
      }
    }
    return ids
  } catch {
    return []
  }
}

export const buildXiaoheiheGameCard = (
  payload: unknown,
  type: XiaoheiheTargetType
): XiaoheiheGameCard | undefined => {
  const root = asObject(payload)
  if (root?.status !== 'ok') return undefined
  const result = asObject(root.result)
  const game = asObject(result?.game) ?? asObject(result?.detail) ?? result
  if (!game) return undefined

  const commentStats = asObject(game.comment_stats)
  const card: XiaoheiheGameCard = {
    name: firstString(game.name, game.game_name, game.title),
    score: firstString(game.score, game.rating, game.heybox_score),
    scoreComment: commentNumber(commentStats?.score_comment),
    price: gamePriceText(game, type),
    cover: optimizeXiaoheiheImageUrl(firstString(game.image, game.cover, game.header_image, game.icon))
  }
  return card.name || card.score ? card : undefined
}

const gamePriceLines = (game: Record<string, any>, type: XiaoheiheTargetType) => {
  const lines: string[] = []
  const price = asObject(game.price)

  if (type === 'pc' && price) {
    const current = firstString(price.current)
    const initial = firstString(price.initial)
    if (current && current !== initial) {
      lines.push(`• 当前价格: ¥${current} (原价: ¥${initial}, -${firstString(price.discount) || 0}%)`)
    } else if (current) {
      lines.push(`• 当前价格: ¥${current}`)
    }
    const lowest = firstString(price.lowest_price)
    if (lowest) lines.push(`• 史低价格: ¥${lowest} (-${firstString(price.lowest_discount) || 0}%)`)
    const deadline = firstString(price.deadline_date)
    if (deadline) lines.push(`• 优惠截止: ${deadline}`)

    const heyboxPrice = asObject(game.heybox_price)
    const coin = Number(heyboxPrice?.cost_coin)
    if (Number.isFinite(coin) && coin > 0) {
      lines.push(`• 小黑盒商城: ${coin / 1000} 盒币`)
      const discount = Number(heyboxPrice?.discount)
      if (Number.isFinite(discount) && discount > 0) {
        lines.push(`  (折扣: -${discount}%, 原价: ${Number(heyboxPrice?.original_coin) / 1000} 盒币)`)
      }
    }
  }

  const regions = objectList(game.region_prices)
  if (type === 'console' && regions.length > 0) {
    const regionLines = regions.map(region => {
      const finalAmount = firstString(region?.final_amount) || '-'
      const initialAmount = firstString(region?.initial_amount)
      let line = `${firstString(region?.region_name) || '地区'}: `
      line += initialAmount && initialAmount !== finalAmount
        ? `${finalAmount} (原价: ${initialAmount}, -${firstString(region?.discount) || 0}%)`
        : finalAmount
      const lowest = firstString(region?.lowest_price)
      if (lowest && lowest !== finalAmount) line += ` / 史低: ${lowest}`
      return line
    })
    lines.push(`🌐 地区价格:\n  ${regionLines.join('\n  ')}`)
  }

  return lines
}

const gameCommunityLines = (game: Record<string, any>) => {
  const lines: string[] = []
  const score = firstString(game.score, game.rating, game.heybox_score)
  const commentStats = asObject(game.comment_stats)
  if (score) lines.push(`• 小黑盒评分: ${score} (${firstString(commentStats?.score_comment) || 0}人评价)`)

  const star5 = Number(commentStats?.star_5)
  if (Number.isFinite(star5) && star5 > 0) {
    lines.push(`• 玩家好评率: ${(star5 / 100).toLocaleString('en-US', { style: 'percent' })}`)
  }

  const radar = asObject(game.multidimensional_score_radar)
  const dimensions = objectList(radar?.dimension_list)
  if (dimensions.length > 0) {
    lines.push('• 多维度评分:')
    for (const dimension of dimensions) {
      lines.push(`  - ${firstString(dimension.dimension_name) || '维度'}: ${firstString(dimension.score) || '-'}`)
    }
  }

  const tagSource = objectList(game.common_tags).length > 0 ? objectList(game.common_tags) : objectList(game.hot_tags)
  const tags = tagSource.map(tag => firstString(tag.desc)).filter(Boolean).map(tag => `#${tag}`)
  if (tags.length > 0) lines.push(`• 热门标签: ${tags.join(' ')}`)

  const userGameData = asObject(game.user_num)?.game_data
  for (const [desc, suffix] of [
    ['小黑盒玩家数', ''],
    ['平均游戏时间', ''],
    ['当前在线', '人'],
    ['昨日峰值在线', '人']
  ] as const) {
    const value = gameDataValue(userGameData, desc)
    if (value) lines.push(`• ${desc}: ${value}${suffix}`)
  }
  for (const desc of ['热门排名', '关注数']) {
    const value = gameDataValue(game.game_data, desc)
    if (value) lines.push(`• ${desc}: ${value}`)
  }

  return lines
}

const gameSteamDeckLine = (game: Record<string, any>) => {
  const steamTag = objectList(game.common_tags).find(tag => tag.type === 'steam_aggre')
  const deck = objectList(steamTag?.detail_list).find(item => item.name === '支持Steam Deck')
  return firstString(deck?.desc)
}

export const normalizeXiaoheiheGame = (
  pageUrl: string,
  type: XiaoheiheTargetType,
  payload: unknown
): ResolvedPost | ResolverFailure => {
  const root = asObject(payload)
  const result = asObject(root?.result)
  const game = asObject(result?.game) ?? asObject(result?.detail) ?? result
  if (root?.status !== 'ok' || !game) return failure('小黑盒游戏 API 返回异常')

  const images: string[] = []
  const videos: string[] = []
  const contentBlocks: RichContentBlock[] = []

  const name = firstString(game.name, game.game_name, game.title) || '小黑盒游戏'
  const nameEn = firstString(game.name_en)
  const cover = firstString(game.image, game.cover, game.header_image, game.icon)
  if (cover) pushUnique(images, cover)

  const score = firstString(game.score, game.rating, game.heybox_score)
  const commentStats = asObject(game.comment_stats)
  const priceText = gamePriceText(game, type)
  const platforms = Array.isArray(game.platforms)
    ? game.platforms.map((item: unknown) => firstString(item)).filter(Boolean).join(' / ')
    : firstString(game.platform, type === 'pc' ? 'PC' : undefined)

  const description = [
    firstString(game.desc, game.description, game.intro),
    nameEn ? `英文名：${nameEn}` : '',
    score !== undefined ? `评分：${score} (${firstString(commentStats?.score_comment) || 0}人评价)` : '',
    priceText !== undefined ? `价格：${priceText}` : '',
    platforms ? `平台：${platforms}` : ''
  ].filter(Boolean).join('\n')

  const gameInfo: string[] = []
  gameInfo.push(`• 中文名: ${name}`)
  if (nameEn) gameInfo.push(`• 英文名: ${nameEn}`)
  const releaseDate = menuValue(game, 'release_date')
  if (releaseDate) gameInfo.push(`• 发行日期: ${releaseDate}`)
  const developer = menuValue(game, 'developer')
  if (developer) gameInfo.push(`• 开发商: ${developer}`)
  const publisher = menuValue(game, 'publisher')
  const publishers = publisher
    ? publisher.split('/').map(item => item.trim()).filter(Boolean)
    : (Array.isArray(game.publishers) ? game.publishers : []).map((item: any) => firstString(item?.value)).filter(Boolean)
  if (publishers.length > 0) gameInfo.push(`• 发行商: ${publishers.join(', ')}`)
  if (platforms) gameInfo.push(`• 支持平台: ${platforms}`)
  const qqGroup = menuValue(game, 'qq')
  if (qqGroup) gameInfo.push(`• QQ交流群: ${qqGroup}`)
  pushTextBlock(contentBlocks, `--- ✨ 游戏信息 ✨ ---\n${gameInfo.join('\n')}`)

  const awards = objectList(game.game_award)
  if (awards.length > 0) {
    const awardLines = awards.map(award => {
      const detail = firstString(award.detail_name) || '奖项'
      return `• ${detail}${award.desc ? ` (${award.desc})` : ''}`
    })
    pushTextBlock(contentBlocks, `--- 🏆 游戏奖项 🏆 ---\n${awardLines.join('\n')}`)
  }

  const priceLines = gamePriceLines(game, type)
  if (priceLines.length > 0) pushTextBlock(contentBlocks, `--- 💰 价格信息 💰 ---\n${priceLines.join('\n')}`)

  const communityLines = gameCommunityLines(game)
  if (communityLines.length > 0) pushTextBlock(contentBlocks, `--- 🌟 社区评价 🌟 ---\n${communityLines.join('\n')}`)

  const steamDeck = gameSteamDeckLine(game)
  if (steamDeck) pushTextBlock(contentBlocks, `--- 🎮 兼容性信息 🎮 ---\n• Steam Deck: ${steamDeck}`)

  const dlc = menuValue(game, 'dlc')
  if (dlc) pushTextBlock(contentBlocks, `--- 🧩 DLCs信息 🧩 ---\n• ${dlc} (点击原链接查看详情)`)

  const about = firstString(game.about_the_game)
  if (about) pushTextBlock(contentBlocks, `--- 📖 游戏简介 📖 ---\n${stripHtml(about)}`)

  const screenshots = objectList(game.screenshots)
  const shotImages = screenshots
    .filter(item => item.type === 'image')
    .map(item => optimizeXiaoheiheImageUrl(firstString(item.url, item.thumbnail)))
    .filter((image): image is string => Boolean(image))
  if (shotImages.length > 0) {
    pushTextBlock(contentBlocks, '--- 🖼️ 游戏截图 🖼️ ---')
    for (const image of shotImages) pushImageBlock(contentBlocks, images, image)
  }

  const movie = screenshots.find(item => item.type === 'movie' && item.url)
  if (movie?.url) videos.push(String(movie.url))

  return {
    platform: 'xiaoheihe',
    displayName: '小黑盒游戏',
    title: name,
    description,
    pageUrl,
    videos: videos.map(url => ({ url })),
    images,
    extras: {
      coverUrl: cover,
      contentBlocks,
      tags: nameEn ? [nameEn] : []
    }
  }
}

const toQueryString = (params: Record<string, string | number>) => {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) search.set(key, String(value))
  return search.toString()
}

const fetchXiaoheiheGameCard = async (gameId: string, cookie: string) => {
  const attempts = await Promise.all(
    (['pc', 'console', 'mobile'] as XiaoheiheTargetType[]).map(async type => {
      try {
        const request = buildXiaoheiheApiRequest(type, gameId)
        const payload = await fetchResolverJson(`${request.url}?${toQueryString(request.params)}`, {
          headers: { Cookie: cookie }
        })
        return buildXiaoheiheGameCard(payload, type)
      } catch {
        return undefined
      }
    })
  )
  return attempts.find((card): card is XiaoheiheGameCard => Boolean(card))
}

export const resolveXiaoheihe = async (url: string, cookie = ''): Promise<ResolverResult> => {
  if (!cookie) return failure('需要在 resolver.yaml 配置 xiaoheihe Cookie')

  const target = extractXiaoheiheTarget(url)
  if (!target) return failure('无法识别小黑盒链接类型')

  const request = buildXiaoheiheApiRequest(target.type, target.id)
  const payload = await fetchResolverJson(`${request.url}?${toQueryString(request.params)}`, {
    headers: {
      Cookie: cookie
    }
  })

  if (target.type !== 'bbs') return normalizeXiaoheiheGame(url, target.type, payload)

  // 帖内嵌游戏卡需要再过一次游戏接口；失败就退回纯链接，不影响帖子主体解析。
  const link = asObject(asObject(asObject(payload)?.result)?.link)
  const gameCards: Record<string, XiaoheiheGameCard> = {}
  await Promise.all(extractXiaoheiheGameIds(link?.text).map(async gameId => {
    const card = await fetchXiaoheiheGameCard(gameId, cookie)
    if (card) gameCards[gameId] = card
  }))

  return normalizeXiaoheihePost(url, payload, gameCards)
}
