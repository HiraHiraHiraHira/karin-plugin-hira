import { dedupeImageUrls } from './media'
import type { ResolvedPost, ResolverFailure, ResolverPlatform, ResolverResult, RichContentBlock } from './types'

type UnknownObject = Record<string, unknown>
export type GeneralNormalizeOptions = {
  platform?: ResolverPlatform
  pageUrl?: string
}

type GeneralFetchJson = (url: string) => Promise<unknown>

const failure = (displayName: string, reason: string, platform: ResolverPlatform = 'general'): ResolverFailure => ({
  platform,
  displayName,
  ok: false,
  reason
})

const asObject = (value: unknown): UnknownObject | undefined => {
  return typeof value === 'object' && value !== null ? value as UnknownObject : undefined
}

const stringValues = (value: unknown): string[] => {
  if (typeof value === 'string' && value.trim()) return [value.trim()]
  if (Array.isArray(value)) return value.flatMap(stringValues)

  const item = asObject(value)
  if (!item) return []
  return [
    item.url,
    item.src,
    item.href,
    item.playUrl,
    item.play_url,
    item.urlList,
    item.url_list,
    item.originUrl,
    item.origin_url,
    item.original,
    item.large
  ].flatMap(stringValues)
}

const firstString = (...values: unknown[]) => {
  for (const value of values) {
    const text = stringValues(value)[0]
    if (text) return text
  }
  return undefined
}

const uniqueStrings = (values: string[]) => {
  const seen = new Set<string>()
  return values.filter(value => {
    if (seen.has(value)) return false
    seen.add(value)
    return true
  })
}

export const isLikelyVideoUrl = (url: string) => {
  const normalized = url.toLowerCase()
  return !(
    /\.(?:mp3|m4a|aac|flac|wav|ogg)(?:[?#]|$)/.test(normalized)
    || normalized.includes('ies-music')
    || normalized.includes('/music/')
  )
}

export const normalizeGeneralApiResponse = (
  displayName: string,
  payload: unknown,
  options: GeneralNormalizeOptions = {}
): ResolvedPost | ResolverFailure => {
  const platform = options.platform || 'general'
  const root = asObject(payload)
  if (!root) return failure(displayName, 'empty response', platform)

  const code = root.code
  if ([-2, -1, 400, 404, 500].includes(Number(code))) return failure(displayName, `api failed: ${String(code)}`, platform)

  const data = asObject(root.data)
  if (!data) return failure(displayName, 'empty data', platform)

  const authorObject = asObject(data.author)
  const userObject = asObject(data.user)
  const title = firstString(data.title, data.name)
  const description = firstString(data.desc, data.description, data.content, data.text, data.summary)
  const author = firstString(
    data.author,
    authorObject?.name,
    authorObject?.nickname,
    data.authorName,
    data.author_name,
    data.nickname,
    data.userName,
    data.user_name,
    userObject?.name,
    userObject?.nickname
  )
  const authorAvatar = firstString(
    data.avatar,
    data.authorAvatar,
    data.author_avatar,
    authorObject?.avatar,
    authorObject?.face,
    userObject?.avatar,
    userObject?.face
  )

  const coverCandidates = [
    data.cover,
    data.coverUrl,
    data.cover_url,
    data.pic,
    data.picture,
    data.thumbnail,
    data.thumb
  ].flatMap(stringValues)
  const rawImages = coverCandidates.concat(
    stringValues(data.images),
    stringValues(data.imageUrl),
    stringValues(data.image_url),
    stringValues(data.pics),
    stringValues(data.picUrls),
    stringValues(data.pic_urls),
    stringValues(data.imgurl)
  )
  const images = dedupeImageUrls(rawImages)
  const coverUrl = dedupeImageUrls(coverCandidates)[0] || images[0]
  const videos = uniqueStrings([
    ...stringValues(data.url),
    ...stringValues(data.playAddr),
    ...stringValues(data.play_addr),
    ...stringValues(data.videoUrl),
    ...stringValues(data.video_url),
    ...stringValues(data.video)
  ]).filter(isLikelyVideoUrl)

  if (videos.length === 0 && images.length === 0) return failure(displayName, 'no media found', platform)

  const contentText = description || title
  const contentBlocks: RichContentBlock[] = [
    contentText ? { type: 'text', text: contentText } : undefined,
    ...images.map(url => ({ type: 'image' as const, url }))
  ].filter((item): item is RichContentBlock => Boolean(item))

  return {
    platform,
    displayName,
    title: title || description || displayName,
    description,
    author,
    pageUrl: options.pageUrl,
    videos,
    images,
    extras: {
      coverUrl,
      ...(authorAvatar ? { authorAvatar } : {}),
      contentBlocks
    }
  }
}

const defaultFetchJson: GeneralFetchJson = async requestUrl => {
  const response = await fetch(requestUrl)
  return response.json()
}

const isFetchJson = (value: GeneralNormalizeOptions | GeneralFetchJson | undefined): value is GeneralFetchJson => (
  typeof value === 'function'
)

export const resolveByGeneralApis = async (
  displayName: string,
  url: string,
  apiTemplates: string[],
  optionsOrFetchJson: GeneralNormalizeOptions | GeneralFetchJson = {},
  fetchJsonOverride?: GeneralFetchJson
): Promise<ResolverResult> => {
  const options = isFetchJson(optionsOrFetchJson) ? {} : optionsOrFetchJson
  const fetchJson = isFetchJson(optionsOrFetchJson) ? optionsOrFetchJson : fetchJsonOverride || defaultFetchJson
  let lastFailure: ResolverFailure = failure(displayName, 'no api configured', options.platform)

  for (const template of apiTemplates) {
    const requestUrl = template.replace('{url}', encodeURIComponent(url))
    try {
      const result = normalizeGeneralApiResponse(displayName, await fetchJson(requestUrl), options)
      if (!('ok' in result)) return result
      lastFailure = result
    } catch (error) {
      lastFailure = failure(displayName, error instanceof Error ? error.message : String(error), options.platform)
    }
  }

  return lastFailure
}
