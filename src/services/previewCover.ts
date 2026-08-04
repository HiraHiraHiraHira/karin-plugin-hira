import { Buffer } from 'node:buffer'

import { Config } from '@/config'
import { readResponseBytes } from '@/services/http'
import { fetchResolverResponse } from '@/services/resolverHttp'

import type { ResolvedPost, ResolverPlatform } from '@/resolvers/types'

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>

const renderableUrlRegExp = /^(?:data:|base64:|file:)/i

const coverReferer: Partial<Record<ResolverPlatform, string>> = {
  weibo: 'https://weibo.com/',
  tieba: 'https://tieba.baidu.com/'
}

const contentTypeFromUrl = (url: string) => {
  if (/\.png(?:[?#]|$)/i.test(url)) return 'image/png'
  if (/\.webp(?:[?#]|$)/i.test(url)) return 'image/webp'
  if (/\.gif(?:[?#]|$)/i.test(url)) return 'image/gif'
  return 'image/jpeg'
}

const headersFromInit = (headers: HeadersInit | undefined) => {
  if (!headers) return undefined
  if (headers instanceof Headers) return Object.fromEntries(headers.entries())
  if (Array.isArray(headers)) return Object.fromEntries(headers)
  return headers
}

const defaultCoverFetcher: FetchLike = (url, init) => fetchResolverResponse(url, {
  headers: headersFromInit(init?.headers),
  signal: init?.signal ?? undefined,
  maxBytes: Config.runtime.maxPreviewCoverBytes
})

const coverFetchTimeoutMs = 8000

export const inlinePreviewCover = async (
  post: ResolvedPost,
  fetcher: FetchLike = defaultCoverFetcher
): Promise<ResolvedPost> => {
  const coverUrl = post.extras?.coverUrl || post.images[0]
  if (!coverUrl || renderableUrlRegExp.test(coverUrl)) return post

  const referer = coverReferer[post.platform]
  if (!referer) return post

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), coverFetchTimeoutMs)
  try {
    const response = await fetcher(coverUrl, {
      signal: controller.signal,
      headers: {
        Referer: referer,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'
      }
    })
    if (!response.ok) return post

    const headerContentType = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase()
    if (headerContentType && !headerContentType.startsWith('image/')) return post

    const bytes = await readResponseBytes(response, Config.runtime.maxPreviewCoverBytes)
    const contentType = headerContentType || contentTypeFromUrl(coverUrl)
    return {
      ...post,
      extras: {
        ...post.extras,
        coverUrl: `data:${contentType};base64,${Buffer.from(bytes).toString('base64')}`
      }
    }
  } catch {
    return post
  } finally {
    clearTimeout(timeout)
  }
}
