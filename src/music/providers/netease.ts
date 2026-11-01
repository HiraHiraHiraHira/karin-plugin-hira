import { logger } from 'node-karin'

import type { MusicItem, MusicPlayable, MusicProvider } from '@/music/types'
import { fetchJson } from '@/services/http'

import { isPlayableAudioUrl, normalizeDuration, requirePlayableUrl } from './helpers'
import { aggregatorAudioUrl, aggregatorSearch } from './aggregator'

type NeteaseProviderOptions = {
  baseUrl: string
  cookie?: string
  fetchJson?: <T = unknown>(url: string, options?: Parameters<typeof fetchJson>[1]) => Promise<T>
}

type NeteaseSearchSong = {
  id: number
  name: string
  artists?: Array<{ name?: string }>
  ar?: Array<{ name?: string }>
  album?: { name?: string, picUrl?: string }
  al?: { name?: string, picUrl?: string }
  duration?: number
  dt?: number
}

const isOfficialNeteaseApiBase = (baseUrl: string) => {
  try {
    const url = new URL(baseUrl)
    return url.hostname === 'music.163.com' && url.pathname.replace(/\/$/, '') === '/api'
  } catch {
    return false
  }
}

export class NeteaseProvider implements MusicProvider {
  readonly source = 'netease' as const
  private readonly baseUrl: string
  private readonly cookie: string
  private readonly requestJson: NonNullable<NeteaseProviderOptions['fetchJson']>

  constructor(options: NeteaseProviderOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, '')
    this.cookie = options.cookie ?? ''
    this.requestJson = options.fetchJson ?? fetchJson
  }

  async search(keyword: string, page: number, pageSize: number): Promise<MusicItem[]> {
    const offset = Math.max(0, page - 1) * pageSize

    try {
      if (isOfficialNeteaseApiBase(this.baseUrl)) {
        const data = await this.requestJson<{ result?: { songs?: NeteaseSearchSong[] } }>(`${this.baseUrl}/cloudsearch/pc`, {
          method: 'POST',
          body: new URLSearchParams({
            offset: String(offset),
            limit: String(pageSize),
            type: '1',
            s: keyword
          }).toString(),
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            Referer: 'https://music.163.com/',
            ...(this.cookie ? { Cookie: this.cookie } : {})
          }
        })

        const items = (data.result?.songs ?? []).map(song => this.toItem(song))
        if (items.length > 0) return items
      } else {
        const url = `${this.baseUrl}/cloudsearch?keywords=${encodeURIComponent(keyword)}&limit=${pageSize}&offset=${offset}`
        const data = await this.requestJson<{ result?: { songs?: NeteaseSearchSong[] } }>(url, this.cookie ? { headers: { Cookie: this.cookie } } : {})

        const items = (data.result?.songs ?? []).map(song => this.toItem(song))
        if (items.length > 0) return items
      }
    } catch {
      // 原生搜索失败时交给聚合音源
    }

    return aggregatorSearch('netease', keyword, page, pageSize, this.requestJson)
  }

  async getPlayable(item: MusicItem): Promise<MusicPlayable> {
    const fallbackUrl = isOfficialNeteaseApiBase(this.baseUrl)
      ? `https://music.163.com/song/media/outer/url?id=${encodeURIComponent(item.id)}`
      : undefined

    if (this.cookie.includes('MUSIC_U=')) {
      try {
        const request = buildNeteaseHighQualityRequest(item.id)
        const data = await this.requestJson<{ data?: Array<{ url?: string, level?: string }> }>(request.url, {
          method: 'POST',
          body: request.body,
          headers: {
            Cookie: this.cookie,
            'Content-Type': 'application/x-www-form-urlencoded'
          }
        })
        const playable = data.data?.[0]
        if (playable?.url) return { item, audioUrl: playable.url, quality: playable.level }
      } catch {
        // Fall back to configured NeteaseCloudMusicApi.
      }
    }

    // fee: 0 免费 / 1 VIP / 4 付费专辑 / 8 低音质免费。免费的直链不必探测，省一次请求
    const fee = Number((item.raw as { fee?: number } | undefined)?.fee ?? 0)
    const fallbackUsable = fallbackUrl && (fee === 0 || await isPlayableAudioUrl(fallbackUrl))
    if (fallbackUrl && fallbackUsable) return { item, audioUrl: fallbackUrl }

    const aggregatedUrl = await aggregatorAudioUrl(item, this.requestJson)
    if (aggregatedUrl && await isPlayableAudioUrl(aggregatedUrl)) return { item, audioUrl: aggregatedUrl }

    if (fallbackUrl) {
      // 会员/版权歌的 outer/url 会跳到 404 页面。但平台 ID 卡（type=163）根本不需要直链，
      // 所以这里不报错，照旧交出去，只记一条日志，方便排查「卡片能出、点开播不了」。
      logger.warn(`[Hira-网易云] 直链校验未通过，仅平台卡片可用 曲目=${item.title} id=${item.id}`)
      return { item, audioUrl: fallbackUrl }
    }

    const url = `${this.baseUrl}/song/url/v1?id=${encodeURIComponent(item.id)}&level=exhigh`
    const data = await this.requestJson<{ data?: Array<{ url?: string, level?: string }> }>(url, this.cookie ? { headers: { Cookie: this.cookie } } : {})
    const playable = data.data?.[0]

    return {
      item,
      audioUrl: requirePlayableUrl(playable?.url),
      quality: playable?.level
    }
  }

  async getLyrics(item: MusicItem): Promise<string | undefined> {
    const data = await this.requestJson<{ lrc?: { lyric?: string }, tlyric?: { lyric?: string } }>(`${this.baseUrl}/lyric?id=${encodeURIComponent(item.id)}`)
    return data.lrc?.lyric || data.tlyric?.lyric
  }

  async checkCookie() {
    if (!this.cookie.trim()) return { ok: false, message: '未配置 Cookie' }
    const data = await this.requestJson<unknown>('https://interface.music.163.com/api/nuser/account/get', {
      headers: { Cookie: this.cookie }
    })
    return normalizeNeteaseCookieStatus(data)
  }

  private toItem(song: NeteaseSearchSong): MusicItem {
    const artists = song.artists ?? song.ar ?? []
    const album = song.album ?? song.al

    return {
      id: String(song.id),
      source: 'netease',
      title: song.name,
      artists: artists.map(item => item.name || '').filter(Boolean),
      album: album?.name,
      durationSeconds: normalizeDuration(song.duration ?? song.dt),
      coverUrl: album?.picUrl,
      pageUrl: `https://music.163.com/#/song?id=${song.id}`,
      raw: song
    }
  }
}

export const buildNeteaseHighQualityRequest = (id: string) => ({
  url: 'https://interface3.music.163.com/api/song/enhance/player/url/v1',
  body: new URLSearchParams({
    ids: `[${id}]`,
    level: 'exhigh',
    encodeType: 'mp3'
  }).toString()
})

export const normalizeNeteaseCookieStatus = (payload: unknown) => {
  const data = payload && typeof payload === 'object' ? payload as { code?: number, profile?: { nickname?: string } } : {}
  if (data.code === 200 && data.profile?.nickname) {
    return { ok: true, message: data.profile.nickname }
  }
  return { ok: false, message: 'Cookie 失效或未登录' }
}
