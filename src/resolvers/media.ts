import type { RichContentBlock, RichMedia } from './types'

export type ImageQuality = NonNullable<RichMedia['quality']>
export type ImageDedupeOptions = {
  dedupe?: boolean
  filterLowQuality?: boolean
}

const trimUrl = (url: string) => url.trim().replace(/\\+$/g, '')

const resizeQueryPattern = /(?:imageView2|imageMogr2|x-oss-process|resize|thumbnail|thumb|blur|format\/webp|[?&](?:w|h|width|height|size)=)/i

export const normalizeMediaKey = (url: string) => {
  const clean = trimUrl(url)
  try {
    const parsed = new URL(clean)
    const rawSearch = parsed.search
    if (rawSearch && resizeQueryPattern.test(rawSearch)) {
      parsed.search = ''
    }
    parsed.hash = ''
    return parsed.toString()
  } catch {
    return clean.replace(/[?#].*$/u, '')
  }
}

const widthFromUrl = (url: string) => {
  const patterns = [
    /(?:^|[/?&,])w[=_/-]?(\d{2,5})(?:\D|$)/i,
    /(?:^|[/?&,])width[=_-]?(\d{2,5})(?:\D|$)/i,
    /\/(\d{2,5})x\d{2,5}(?:\D|$)/i
  ]
  for (const pattern of patterns) {
    const value = Number(url.match(pattern)?.[1])
    if (Number.isFinite(value) && value > 0) return value
  }
  return 0
}

export const imageQuality = (url: string): ImageQuality => {
  const clean = trimUrl(url).toLowerCase()
  if (!clean) return 'blurred'
  if (/blur|blurred|mosaic|placeholder|blurhash|imageMogr2\/blur/i.test(clean)) return 'blurred'
  if (/\/(?:thumb|thumbnail|preview|small)(?:[/?#]|$)|(?:^|[?&])thumb=|\/s\d{2,3}\//i.test(clean)) return 'thumbnail'

  const width = widthFromUrl(clean)
  if (width > 0 && width <= 320) return 'thumbnail'
  if (/original|origin|large|raw|1080|1440|2160/i.test(clean)) return 'original'
  return 'normal'
}

const qualityBaseScore = (quality: ImageQuality) => ({
  original: 4000,
  normal: 3000,
  thumbnail: 1000,
  blurred: 0
})[quality]

const imageScore = (url: string) => qualityBaseScore(imageQuality(url)) + Math.min(widthFromUrl(url), 3000)

export const isUsableImageUrl = (url: string) => {
  const quality = imageQuality(url)
  return quality === 'original' || quality === 'normal'
}

export const selectBestImageUrl = (values: Array<string | undefined>) => {
  const candidates = values.map(value => typeof value === 'string' ? value.trim() : '').filter(Boolean)
  if (candidates.length === 0) return undefined
  return candidates.sort((left, right) => imageScore(right) - imageScore(left))[0]
}

export const dedupeImageUrls = (urls: string[], options: ImageDedupeOptions = {}) => {
  const bestByKey = new Map<string, string>()
  for (const url of urls) {
    if (!url.trim()) continue
    const key = normalizeMediaKey(url)
    const current = bestByKey.get(key)
    if (!current || imageScore(url) > imageScore(current)) bestByKey.set(key, url)
  }

  const values = [...bestByKey.values()]
  if (options.filterLowQuality === false) return values
  const usable = values.filter(isUsableImageUrl)
  if (usable.length > 0) return usable
  return values.filter(url => imageQuality(url) !== 'blurred')
}

export const dedupeRichContentBlocks = (blocks: RichContentBlock[], options: ImageDedupeOptions = {}) => {
  if (options.dedupe === false) {
    return blocks.filter(block => {
      if (block.type === 'text') return Boolean(block.text.trim())
      if (options.filterLowQuality === false) return Boolean(block.url.trim())
      return isUsableImageUrl(block.url) || imageQuality(block.url) !== 'blurred'
    })
  }

  const bestImageByKey = new Map<string, string>()
  for (const block of blocks) {
    if (block.type !== 'image') continue
    const key = normalizeMediaKey(block.url)
    const current = bestImageByKey.get(key)
    if (!current || imageScore(block.url) > imageScore(current)) bestImageByKey.set(key, block.url)
  }

  const seenImages = new Set<string>()
  return blocks.filter(block => {
    if (block.type === 'text') return Boolean(block.text.trim())

    const key = normalizeMediaKey(block.url)
    if (seenImages.has(key)) return false
    if (bestImageByKey.get(key) !== block.url) return false
    if (options.filterLowQuality !== false && !isUsableImageUrl(block.url) && imageQuality(block.url) === 'blurred') return false
    seenImages.add(key)
    return true
  })
}
