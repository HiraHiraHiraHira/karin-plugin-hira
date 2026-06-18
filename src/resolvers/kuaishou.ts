import { resolveByGeneralApis } from './general'
import type { ResolverResult } from './types'

export const extractKuaishouVideoId = (url: string) => {
  try {
    const parsed = new URL(url)
    return parsed.pathname.match(/\/short-video\/([^/?]+)/)?.[1]
      || parsed.pathname.match(/\/fw\/(?:photo|long-video)\/([^/?]+)/)?.[1]
  } catch {
    return undefined
  }
}

export const normalizeKuaishouUrl = async (
  url: string,
  expandUrl: (url: string) => Promise<string> = async input => input
) => {
  const expanded = url.includes('v.kuaishou.com') ? await expandUrl(url) : url
  const id = extractKuaishouVideoId(expanded)
  return id ? `https://www.kuaishou.com/short-video/${id}` : undefined
}

export const resolveKuaishou = async (url: string, generalApis: string[]): Promise<ResolverResult> => {
  const normalized = await normalizeKuaishouUrl(url, async input => {
    const response = await fetch(input, { redirect: 'follow' })
    return response.url || input
  })

  if (!normalized) {
    return {
      platform: 'kuaishou',
      displayName: '快手',
      ok: false,
      reason: '无法识别快手视频 ID'
    }
  }

  return resolveByGeneralApis('快手', normalized, generalApis, {
    platform: 'kuaishou',
    pageUrl: normalized
  })
}
