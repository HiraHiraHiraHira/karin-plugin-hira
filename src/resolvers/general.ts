import { fetchResolverJson, resolveResolverRedirectUrl } from '@/services/resolverHttp'

import { resolveAcfun } from './acfun'
import { dedupeImageUrls } from './media'
import { resolvePipixia } from './pipixia'
import type { ResolvedPost, ResolverFailure, ResolverPlatform, ResolverResult, RichContentBlock } from './types'
import { hostnameOf } from './url'

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
    videos: videos.map(url => ({ url })),
    images,
    extras: {
      coverUrl,
      ...(authorAvatar ? { authorAvatar } : {}),
      contentBlocks
    }
  }
}

const defaultFetchJson: GeneralFetchJson = async requestUrl => fetchResolverJson(requestUrl)

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
      const reason = error instanceof Error ? error.message : String(error)
      let endpointHost = 'unknown'
      try { endpointHost = new URL(requestUrl).host } catch { /* keep the safe fallback */ }
      lastFailure = failure(displayName, `api request failed (${endpointHost}): ${reason}`, options.platform)
    }
  }

  return lastFailure
}

const isHost = (hostname: string, domain: string) => hostname === domain || hostname.endsWith(`.${domain}`)

export type GeneralResolveDeps = {
  /** 短链展开失败不应该让解析整体失败，调用方传入可注入的实现便于测试。 */
  expandShortUrl?: (url: string) => Promise<string>
}

/**
 * 西瓜短链（v.ixigua.com/xxx）先跟一次跳转拿到数字视频 id，再统一成 `www.ixigua.com/<id>`；
 * R 插件在 controller 阶段就还原短链，否则第三方接口拿到的短链经常 404。
 */
export const normalizeXiguaUrl = async (url: string, expand: (url: string) => Promise<string>) => {
  const hostname = hostnameOf(url) || ''
  if (!isHost(hostname, 'ixigua.com')) return url

  let target = url
  if (hostname.startsWith('v.')) {
    try {
      target = await expand(url)
    } catch {
      target = url
    }
  }

  const id = target.match(/ixigua\.com\/(\d+)/)?.[1] || target.match(/\/video\/(\d+)/)?.[1]
  return id ? `https://www.ixigua.com/${id}` : target
}

type GeneralPlatform = {
  displayName: string
  resolveNative?: (url: string) => Promise<ResolverResult>
}

/** 域名决定展示名：通用平台此前一律显示「通用解析」，和 R 插件的「识别：西瓜」不符。 */
const generalPlatformOf = (url: string): GeneralPlatform => {
  const hostname = hostnameOf(url) || ''
  if (isHost(hostname, 'pipix.com')) return { displayName: '皮皮虾', resolveNative: resolvePipixia }
  if (isHost(hostname, 'acfun.cn')) return { displayName: 'AcFun', resolveNative: resolveAcfun }
  if (isHost(hostname, 'ixigua.com')) return { displayName: '西瓜' }
  if (isHost(hostname, 'pipigx.com')) return { displayName: '皮皮搞笑' }
  if (isHost(hostname, 'xsj.qq.com')) return { displayName: 'QQ小世界' }
  if (isHost(hostname, 'okjike.com')) return { displayName: '即刻' }
  return { displayName: '通用解析' }
}

/**
 * 通用平台入口：先走原生解析（皮皮虾无水印视频/评论、AcFun 稿件详情），
 * 失败或平台没有原生实现时降级到第三方接口轮换。
 */
export const resolveGeneral = async (
  url: string,
  apiTemplates: string[],
  deps: GeneralResolveDeps = {}
): Promise<ResolverResult> => {
  const platform = generalPlatformOf(url)

  if (platform.resolveNative) {
    const native = await platform.resolveNative(url).catch((): ResolverResult => failure(platform.displayName, '原生解析失败'))
    if (!('ok' in native)) return native
  }

  const expand = deps.expandShortUrl ?? resolveResolverRedirectUrl
  const targetUrl = await normalizeXiguaUrl(url, expand)
  return resolveByGeneralApis(platform.displayName, targetUrl, apiTemplates, {
    platform: 'general',
    pageUrl: targetUrl
  })
}
