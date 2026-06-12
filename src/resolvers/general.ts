import type { ResolvedPost, ResolverFailure, ResolverResult } from './types'

type UnknownObject = Record<string, unknown>

const failure = (displayName: string, reason: string): ResolverFailure => ({
  platform: 'general',
  displayName,
  ok: false,
  reason
})

const asObject = (value: unknown): UnknownObject | undefined => {
  return typeof value === 'object' && value !== null ? value as UnknownObject : undefined
}

const asStringArray = (value: unknown): string[] => {
  if (typeof value === 'string' && value.trim()) return [value]
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
}

export const isLikelyVideoUrl = (url: string) => {
  const normalized = url.toLowerCase()
  return !(
    /\.(?:mp3|m4a|aac|flac|wav|ogg)(?:[?#]|$)/.test(normalized)
    || normalized.includes('ies-music')
    || normalized.includes('/music/')
  )
}

export const normalizeGeneralApiResponse = (displayName: string, payload: unknown): ResolvedPost | ResolverFailure => {
  const root = asObject(payload)
  if (!root) return failure(displayName, 'empty response')

  const code = root.code
  if ([-2, -1, 400, 404, 500].includes(Number(code))) return failure(displayName, `api failed: ${String(code)}`)

  const data = asObject(root.data)
  if (!data) return failure(displayName, 'empty data')

  const videos = asStringArray(data.url).concat(asStringArray(data.playAddr)).filter(isLikelyVideoUrl)
  const images = asStringArray(data.images)
    .concat(asStringArray(data.imageUrl))
    .concat(asStringArray(data.pics))
    .concat(asStringArray(data.imgurl))

  if (videos.length === 0 && images.length === 0) return failure(displayName, 'no media found')

  return {
    platform: 'general',
    displayName,
    title: String(data.title || data.desc || ''),
    videos,
    images
  }
}

export const resolveByGeneralApis = async (
  displayName: string,
  url: string,
  apiTemplates: string[],
  fetchJson: (url: string) => Promise<unknown> = async requestUrl => {
    const response = await fetch(requestUrl)
    return response.json()
  }
): Promise<ResolverResult> => {
  let lastFailure: ResolverFailure = failure(displayName, 'no api configured')

  for (const template of apiTemplates) {
    const requestUrl = template.replace('{url}', encodeURIComponent(url))
    try {
      const result = normalizeGeneralApiResponse(displayName, await fetchJson(requestUrl))
      if (!('ok' in result)) return result
      lastFailure = result
    } catch (error) {
      lastFailure = failure(displayName, error instanceof Error ? error.message : String(error))
    }
  }

  return lastFailure
}
