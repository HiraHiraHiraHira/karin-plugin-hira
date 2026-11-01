import crypto from 'node:crypto'

import type { MusicItem, MusicPlayable, MusicProvider } from '@/music/types'
import { fetchJson } from '@/services/http'

import { normalizeDuration, requirePlayableUrl } from './helpers'
import { aggregatorAudioUrl, aggregatorSearch } from './aggregator'

type QQProviderOptions = {
  tempApi?: string
  cookie?: string
  fetchJson?: <T = unknown>(url: string, options?: Parameters<typeof fetchJson>[1]) => Promise<T>
}

type QQSearchSong = {
  mid?: string
  songmid?: string
  id?: number
  songid?: number
  name?: string
  songname?: string
  singer?: Array<{ name?: string }>
  album?: { name?: string, pmid?: string, mid?: string }
  interval?: number
}

type QQClientSearchSong = {
  songmid?: string
  songname?: string
  singer?: Array<{ name?: string }>
  albummid?: string
  albumname?: string
  interval?: number
}

type QQProfileResponse = {
  code?: number
  data?: {
    creator?: {
      nick?: string
    }
  }
}

const musicuUrl = 'https://u.y.qq.com/cgi-bin/musicu.fcg'
const profileUrl = 'https://c.y.qq.com/rsc/fcgi-bin/fcg_get_profile_homepage.fcg?format=json'
/** 旧版搜索接口：不需要登录态，musicu 桌面搜索未登录时返回 2001 空列表，用它兜底 */
const legacySearchUrl = 'https://c.y.qq.com/soso/fcgi-bin/client_search_cp'

const asRecord = (value: unknown): Record<string, unknown> => {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {}
}

export const normalizeQQSearchResult = (payload: unknown): MusicItem[] => {
  const root = asRecord(payload)
  const req = asRecord(root.req_1)
  const data = asRecord(req.data)
  const body = asRecord(data.body)
  const song = asRecord(body.song)
  const list = Array.isArray(song.list) ? song.list as QQSearchSong[] : []

  return list.map(item => {
    const mid = item.mid || item.songmid || String(item.id ?? item.songid ?? '')
    const albumMid = item.album?.pmid || item.album?.mid || ''
    return {
      id: mid,
      source: 'qq' as const,
      title: item.name || item.songname || '未知歌曲',
      artists: (item.singer ?? []).map(singer => singer.name || '').filter(Boolean),
      album: item.album?.name,
      durationSeconds: normalizeDuration(item.interval),
      coverUrl: albumMid ? `https://y.qq.com/music/photo_new/T002R300x300M000${albumMid}.jpg` : undefined,
      pageUrl: `https://y.qq.com/n/ryqq/songDetail/${mid}`,
      raw: item
    }
  }).filter(item => item.id)
}

/** 旧搜索接口的返回结构：data.song.list[]，字段是 songmid/songname/singer[].name/albummid/interval */
export const normalizeQQClientSearchResult = (payload: unknown): MusicItem[] => {
  const root = asRecord(payload)
  const data = asRecord(root.data)
  const song = asRecord(data.song)
  const list = Array.isArray(song.list) ? song.list as QQClientSearchSong[] : []

  return list.map(item => {
    const mid = (item.songmid || '').trim()
    return {
      id: mid,
      source: 'qq' as const,
      title: item.songname || '未知歌曲',
      artists: (item.singer ?? []).map(singer => singer.name || '').filter(Boolean),
      album: item.albumname,
      durationSeconds: normalizeDuration(item.interval),
      coverUrl: item.albummid ? `https://y.qq.com/music/photo_new/T002R300x300M000${item.albummid}.jpg` : undefined,
      pageUrl: `https://y.qq.com/n/ryqq/songDetail/${mid}`,
      raw: item
    }
  }).filter(item => item.id)
}

export const pickQQPlayableUrl = (payload: unknown) => {
  const root = asRecord(payload)
  const req = asRecord(root.req_0)
  const data = asRecord(req.data)
  const sip = Array.isArray(data.sip) ? String(data.sip[0] ?? '') : ''
  const midurlinfo = Array.isArray(data.midurlinfo) ? data.midurlinfo as Array<{ purl?: string }> : []
  const purl = midurlinfo.find(item => item.purl)?.purl
  if (!purl) return undefined
  if (/^https?:\/\//i.test(purl)) return purl
  return `${sip}${purl}`
}

export const decodeQQLyric = (value: string | undefined) => {
  if (!value) return undefined
  return Buffer.from(value, 'base64').toString('utf8')
}

export const normalizeQQCookieStatus = (payload: unknown) => {
  const data = asRecord(payload)
  const profile = data.data as QQProfileResponse['data'] | undefined
  const nick = profile?.creator?.nick?.trim()
  if (data.code === 0 && nick) {
    return { ok: true, message: nick }
  }
  return { ok: false, message: 'Cookie 失效或未登录' }
}

const buildQQSearchBody = (keyword: string, page: number, pageSize: number) => ({
  req_1: {
    method: 'DoSearchForQQMusicDesktop',
    module: 'music.search.SearchCgiService',
    param: {
      query: keyword,
      page_num: page,
      num_per_page: pageSize,
      search_type: 0
    }
  }
})

const buildQQVkeyBody = (songmid: string) => ({
  req_0: {
    module: 'vkey.GetVkeyServer',
    method: 'CgiGetVkey',
    param: {
      guid: '10000',
      songmid: [songmid],
      songtype: [0],
      uin: '0',
      loginflag: 1,
      platform: '20',
      filename: [`M800${songmid}.mp3`]
    }
  }
})

const qqSongmidPattern = /^[0-9A-Za-z]{14}$/
const qqShareSalt = 'q;z(&l~sdf2!nK'

export const buildLegacyQQShareMusicUrl = (songmid: string, uin = '0') => {
  if (!qqSongmidPattern.test(songmid)) return undefined
  const code = crypto.createHash('md5').update(`${songmid}${qqShareSalt}`).digest('hex').slice(0, 5).toUpperCase()
  return `http://c6.y.qq.com/rsc/fcgi-bin/fcg_pyq_play.fcg?songid=&songmid=${songmid}&songtype=1&fromtag=50&uin=${uin}&code=${code}`
}

export class QQProvider implements MusicProvider {
  readonly source = 'qq' as const
  private readonly tempApi: string
  private readonly cookie: string
  private readonly requestJson: NonNullable<QQProviderOptions['fetchJson']>

  constructor(options: QQProviderOptions) {
    this.tempApi = options.tempApi ?? ''
    this.cookie = options.cookie ?? ''
    this.requestJson = options.fetchJson ?? fetchJson
  }

  /** 官方桌面搜索：未登录态下可能返回 code 2001 空列表 */
  private async searchOfficial(keyword: string, page: number, pageSize: number): Promise<MusicItem[]> {
    try {
      const data = await this.requestJson(musicuUrl, {
        method: 'POST',
        body: JSON.stringify(buildQQSearchBody(keyword, page, pageSize)),
        headers: {
          'Content-Type': 'application/json',
          Referer: 'https://y.qq.com/',
          ...(this.cookie ? { Cookie: this.cookie } : {})
        }
      })
      return normalizeQQSearchResult(data)
    } catch {
      return []
    }
  }

  /** 旧搜索接口：不需要登录态，官方接口拿不到结果时兜底 */
  private async searchLegacy(keyword: string, page: number, pageSize: number): Promise<MusicItem[]> {
    try {
      const url = `${legacySearchUrl}?w=${encodeURIComponent(keyword)}&format=json&n=${pageSize}&p=${page}&cr=1&g_tk=5381`
      const data = await this.requestJson(url, {
        headers: {
          Referer: 'https://y.qq.com/',
          ...(this.cookie ? { Cookie: this.cookie } : {})
        }
      })
      return normalizeQQClientSearchResult(data)
    } catch {
      return []
    }
  }

  async search(keyword: string, page: number, pageSize: number): Promise<MusicItem[]> {
    const official = await this.searchOfficial(keyword, page, pageSize)
    if (official.length > 0) return official

    const legacy = await this.searchLegacy(keyword, page, pageSize)
    if (legacy.length > 0) return legacy

    const aggregated = await aggregatorSearch('qq', keyword, page, pageSize, this.requestJson)
    if (aggregated.length > 0) return aggregated

    // 三个搜索接口都没结果时直接报错：以前会退化成「青花瓷 #1」这种假 id 的占位列表，
    // 用户点进去才在取直链时报错，反而更难理解
    throw new Error('QQ音乐搜索暂时不可用，可以试试「#网易点歌 歌名」或稍后再试')
  }

  async getPlayable(item: MusicItem): Promise<MusicPlayable> {
    try {
      const data = await this.requestJson(musicuUrl, {
        method: 'POST',
        body: JSON.stringify(buildQQVkeyBody(item.id)),
        headers: {
          'Content-Type': 'application/json',
          Referer: 'https://y.qq.com/',
          ...(this.cookie ? { Cookie: this.cookie } : {})
        }
      })
      const audioUrl = pickQQPlayableUrl(data)
      if (audioUrl) return { item, audioUrl }
    } catch {
      // Fall back to configured temp API.
    }

    // 匿名 vkey 现在常返回空 purl；聚合音源能给出完整时长的直链，优先于只有 60 秒的分享直链
    const aggregatedUrl = await aggregatorAudioUrl(item, this.requestJson)
    if (aggregatedUrl) return { item, audioUrl: aggregatedUrl }

    const legacyUrl = buildLegacyQQShareMusicUrl(item.id)
    if (legacyUrl) return { item, audioUrl: legacyUrl }

    if (!this.tempApi) throw new Error('QQ音乐暂未返回可播放链接')
    const raw = item.raw as { keyword?: string, index?: number } | undefined
    const keyword = raw?.keyword || item.title
    const index = raw?.index || 1
    const url = this.tempApi
      .replace('{keyword}', encodeURIComponent(keyword))
      .replace('{index}', String(index))

    const data = await fetchJson<{ music_url?: string, url?: string, data?: { music_url?: string, url?: string } }>(url)
    const audioUrl = data.music_url || data.url || data.data?.music_url || data.data?.url

    return {
      item,
      audioUrl: requirePlayableUrl(audioUrl)
    }
  }

  async getLyrics(item: MusicItem): Promise<string | undefined> {
    const url = `https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg?songmid=${encodeURIComponent(item.id)}&format=json&nobase64=0`
    const data = await this.requestJson<{ lyric?: string, trans?: string }>(url, {
      headers: {
        Referer: 'https://y.qq.com/',
        ...(this.cookie ? { Cookie: this.cookie } : {})
      }
    })
    const lyric = decodeQQLyric(data.lyric)
    const trans = decodeQQLyric(data.trans)
    return [lyric, trans].filter(Boolean).join('\n\n')
  }

  async checkCookie() {
    if (!this.cookie.trim()) return { ok: false, message: '未配置 Cookie' }
    const data = await this.requestJson<unknown>(profileUrl, {
      headers: {
        Referer: 'https://y.qq.com/',
        Cookie: this.cookie
      }
    })
    return normalizeQQCookieStatus(data)
  }
}
