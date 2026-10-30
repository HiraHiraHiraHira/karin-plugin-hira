import { fetchResponse } from '@/services/http'

export const formatArtists = (artists: string[]) => {
  const clean = artists.map(artist => artist.trim()).filter(Boolean)
  return clean.length > 0 ? clean.join(' / ') : '未知歌手'
}

export const normalizeDuration = (value: number | string | undefined) => {
  if (value === undefined) return undefined

  if (typeof value === 'number') {
    return value > 10000 ? Math.round(value / 1000) : Math.round(value)
  }

  const parts = value.split(':').map(part => Number(part))
  if (parts.some(part => Number.isNaN(part))) return undefined

  if (parts.length === 2) return parts[0] * 60 + parts[1]
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2]

  return undefined
}

export const requirePlayableUrl = (url: string | undefined) => {
  if (!url?.trim()) throw new Error('没有拿到可播放的音频链接，稍后再试或换个音乐源')
  return url
}

/**
 * 轻量校验直链能不能播：只看响应头，不下载音频。
 * 网易云 `song/media/outer/url` 对会员/版权受限的歌会跳到 404 页面（text/html），
 * 直接发出去就是一张点得出、点不动的卡。
 */
export const isPlayableAudioUrl = async (url: string | undefined): Promise<boolean> => {
  if (!url?.trim()) return false
  try {
    const response = await fetchResponse(url, { method: 'HEAD', timeoutMs: 8000 })
    const contentType = (response.headers.get('content-type') || '').toLowerCase()
    return response.ok && (contentType.startsWith('audio/') || contentType.includes('octet-stream'))
  } catch {
    return false
  }
}

/** 统一 provider 报错文案: 源名 + 原因, 避免把底层英文错误直接甩给用户. */
export const providerError = (label: string, reason: unknown) => {
  const message = reason instanceof Error ? reason.message : String(reason)
  return new Error(message.startsWith(`${label}：`) ? message : `${label}：${message}`)
}
