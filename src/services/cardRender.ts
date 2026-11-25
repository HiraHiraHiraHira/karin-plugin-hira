import fs from 'node:fs'
import crypto from 'node:crypto'
import path from 'node:path'

import type { ImageElement } from 'node-karin'
import { karinPathHtml, logger, render as karinRender, segment } from 'node-karin'

import { Root } from '@/root'

import type { RenderOptions } from './cardRender/types'

export type {
  ErrorCardOptions,
  HelpCardGroup,
  HelpCardItem,
  MusicListCardItem,
  ResolverPreviewCardOptions,
  StatusCardItem,
  StatusCardOptions,
  TemplateHtmlOptions,
  UpdateCardOptions,
  UpdateCardState
} from './cardRender/types'

export {
  buildErrorCardHtml,
  buildHelpCardHtml,
  buildMusicListCardHtml,
  buildStatusCardHtml,
  buildUpdateCardHtml,
  renderTemplateHtml
} from './cardRender/templates'

export {
  buildResolverCardHtml,
  buildResolverPreviewCardHtml,
  buildXiaoheihePreviewCardHtml,
  buildXiaohongshuPreviewCardHtml
} from './cardRender/resolverCards'

export const writeCardHtmlFile = (html: string, name: string) => {
  const safeName = name.replace(/[^\w.-]+/g, '_') || 'card'
  const dir = path.join(karinPathHtml, Root.pluginName, `card-${safeName}`)
  fs.mkdirSync(dir, { recursive: true })
  const contentHash = crypto.createHash('md5').update(html).digest('hex').slice(0, 8)
  const file = path.join(dir, `${safeName}-${contentHash}.html`)
  if (fs.existsSync(file)) {
    const now = new Date()
    fs.utimesSync(file, now, now)
    return file
  }
  fs.writeFileSync(file, html, 'utf8')
  return file
}

/**
 * 相同 HTML(+宽度) 直接复用上次截图, 参考 R apps/help.js:31-42 的 md5 缓存.
 * 截图成本高且状态卡/帮助卡在短时间内高度重复; 限制条数避免常驻内存膨胀.
 * 一次性卡片(点歌列表/解析预览)的 HTML 每次不同, 首次渲染不入缓存, 第二次遇到同一 key
 * 才说明会被复用 (评审 I3), 避免 64 个 LRU 槽被一次性卡片挤满.
 */
const cardImageCache = new Map<string, ImageElement[]>()
const pendingCardImageKeys = new Set<string>()
const cardImageCacheLimit = 64
const pendingCardKeysLimit = 256

export const clearCardRenderCache = () => {
  cardImageCache.clear()
  pendingCardImageKeys.clear()
}

const readCardImageCache = (key: string) => {
  const cached = cardImageCache.get(key)
  if (!cached) return undefined
  // LRU: 命中后移到末尾, 淘汰最久未用的条目.
  cardImageCache.delete(key)
  cardImageCache.set(key, cached)
  return cached
}

const writeCardImageCache = (key: string, images: ImageElement[]) => {
  cardImageCache.set(key, images)
  while (cardImageCache.size > cardImageCacheLimit) {
    const oldest = cardImageCache.keys().next().value
    if (oldest === undefined) break
    cardImageCache.delete(oldest)
  }
}

const trackPendingCardKey = (key: string) => {
  pendingCardImageKeys.add(key)
  while (pendingCardImageKeys.size > pendingCardKeysLimit) {
    const oldest = pendingCardImageKeys.values().next().value
    if (oldest === undefined) break
    pendingCardImageKeys.delete(oldest)
  }
}

export const renderCardImage = async ({
  name,
  html,
  width = 760,
  writeHtml = writeCardHtmlFile,
  render = karinRender.render.bind(karinRender) as (options: Record<string, unknown>) => Promise<string | string[]>
}: RenderOptions): Promise<ImageElement[]> => {
  const cacheKey = crypto.createHash('md5').update(`${width}\n${html}`).digest('hex')
  const cached = readCardImageCache(cacheKey)
  if (cached) {
    logger.debug(`[${Root.pluginName}] Render card ${name}: cache hit`)
    return cached
  }

  const file = writeHtml(html, name)
  const result = await render({
    name: `${Root.pluginName}/card-${name}`,
    file,
    selector: '#container',
    fullPage: false,
    type: 'png',
    captureBeyondViewport: true,
    omitBackground: true,
    setViewport: {
      width,
      height: 900,
      deviceScaleFactor: 1
    },
    pageGotoParams: {
      waitUntil: 'load',
      timeout: 10_000
    }
  })
  const images = (Array.isArray(result) ? result : [result]).map(image => segment.image(`base64://${image}`))
  // 第二次出现同一 HTML 才入缓存: 说明这张卡会被复用 (见 pendingCardImageKeys 说明).
  if (pendingCardImageKeys.delete(cacheKey)) writeCardImageCache(cacheKey, images)
  else trackPendingCardKey(cacheKey)
  logger.debug(`[${Root.pluginName}] Render card ${name}: ${file}, images=${images.length}`)
  return images
}

export const logCardRenderFailure = (name: string, error: unknown) => {
  const message = error instanceof Error ? error.stack || error.message : String(error)
  logger.error(`[${Root.pluginName}] Render card ${name} failed: ${message}`)
}
