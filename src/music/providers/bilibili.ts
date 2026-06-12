import { createHash } from 'node:crypto'

import type { MusicItem, MusicPlayable, MusicProvider } from '@/music/types'
import { fetchJson } from '@/services/http'

import { normalizeDuration } from './helpers'

type BilibiliProviderOptions = {
  cookie?: string
  fetchJson?: typeof fetchJson
}

type BilibiliAppSearchItem = {
  title?: string
  author?: string
  cover?: string
  duration?: number | string
  param?: string
  uri?: string
  share?: {
    video?: {
      bvid?: string
      short_link?: string
    }
  }
}

type BilibiliVideoInfo = {
  data?: BilibiliVideoRef
}

type BilibiliVideoRef = {
  aid?: number
  bvid?: string
  cid?: number
  title?: string
  pic?: string
  owner?: { name?: string }
  duration?: number
}

type BilibiliAudioStream = {
  id?: number
  baseUrl?: string
  base_url?: string
  backupUrl?: string[]
  backup_url?: string[]
}

type BilibiliPlayUrl = {
  data?: {
    dash?: {
      audio?: BilibiliAudioStream[]
    }
  }
}

const bvPattern = /\bBV[1-9A-HJ-NP-Za-km-z]{10}\b/
const bilibiliAppSecret = '560c52ccd288fed045859ed18bffd973'
const bilibiliAppHeaders = {
  'User-Agent': 'Dalvik/2.1.0 (Linux; U; Android 12; MI 9 Build/SKQ1.211230.001)'
}

const stripHtml = (value: string | undefined) => (value ?? '').replace(/<[^>]+>/g, '').trim()

const normalizeCover = (url: string | undefined) => {
  if (!url) return undefined
  return url.startsWith('//') ? `https:${url}` : url
}

const signedBilibiliAppUrl = (url: string, params: Record<string, string | number>) => {
  const param = Object.entries(params)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join('&')
  const sign = createHash('md5').update(`${param}${bilibiliAppSecret}`).digest('hex')
  return `${url}?${param}&sign=${sign}`
}

const bilibiliAppParams = (extra: Record<string, string | number>) => ({
  access_key: '',
  appkey: '1d8b6e7d45233436',
  build: 7210300,
  buvid: 'XU973E09237CC101E74F6E24CCF3DE3300D0B',
  c_locale: 'zh_CN',
  channel: 'xiaomi',
  disable_rcmd: 0,
  fnval: 16,
  fnver: 0,
  fourk: 1,
  is_dolby: 0,
  is_h265: 0,
  is_proj: 1,
  live_extra: '',
  mobi_app: 'android',
  mobile_access_key: '',
  platform: 'android',
  playurl_type: 1,
  protocol: 1,
  qn: 64,
  s_locale: 'zh_CN',
  statistics: '%7B%22appId%22%3A1%2C%22platform%22%3A3%2C%22version%22%3A%227.21.0%22%2C%22abtest%22%3A%22%22%7D',
  sys_ver: 31,
  ts: Math.floor(Date.now() / 1000),
  video_type: 0,
  ...extra
})

const getItemBvid = (item: BilibiliAppSearchItem) => {
  return item.share?.video?.bvid || item.param?.match(bvPattern)?.[0] || item.uri?.match(bvPattern)?.[0]
}

export const selectBilibiliAudio = (payload: BilibiliPlayUrl) => {
  const audio = payload.data?.dash?.audio ?? []
  const selected = audio
    .map(item => ({
      id: item.id ?? 0,
      url: item.baseUrl || item.base_url || item.backupUrl?.[0] || item.backup_url?.[0] || ''
    }))
    .filter(item => item.url)
    .sort((a, b) => b.id - a.id)[0]

  return selected
}

export class BilibiliMusicProvider implements MusicProvider {
  readonly source = 'bilibili' as const
  private readonly cookie: string
  private readonly requestJson: typeof fetchJson

  constructor(options: BilibiliProviderOptions = {}) {
    this.cookie = options.cookie ?? ''
    this.requestJson = options.fetchJson ?? fetchJson
  }

  private requestOptions(referer?: string) {
    return {
      headers: {
        ...bilibiliAppHeaders,
        ...(referer ? { Referer: referer } : {}),
        ...(this.cookie ? { Cookie: this.cookie } : {})
      }
    }
  }

  async search(keyword: string, page: number, pageSize: number): Promise<MusicItem[]> {
    const url = signedBilibiliAppUrl('https://app.bilibili.com/x/v2/search/type', bilibiliAppParams({
      keyword: encodeURIComponent(keyword),
      type: 10,
      pn: page,
      ps: pageSize
    }))
    const data = await this.requestJson<{ data?: { items?: BilibiliAppSearchItem[] } }>(url, this.requestOptions())

    return (data.data?.items ?? [])
      .map((item): MusicItem | undefined => {
        const bvid = getItemBvid(item)
        if (!bvid) return undefined

        const author = stripHtml(item.author)
        return {
          id: bvid,
          source: 'bilibili',
          title: stripHtml(item.title) || 'B站视频音频',
          artists: author ? [author] : [],
          durationSeconds: normalizeDuration(item.duration),
          coverUrl: normalizeCover(item.cover),
          pageUrl: item.share?.video?.short_link || `https://www.bilibili.com/video/${bvid}`,
          raw: item
        }
      })
      .filter((item): item is MusicItem => Boolean(item))
  }

  private async resolveVideoInfo(item: MusicItem): Promise<BilibiliVideoRef> {
    const raw = item.raw as BilibiliVideoRef | undefined
    if (raw?.aid && raw?.cid) return raw

    const bvid = item.id.match(bvPattern)?.[0] || item.pageUrl.match(bvPattern)?.[0]
    if (!bvid) return {}

    const data = await this.requestJson<BilibiliVideoInfo>(
      `https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`,
      this.requestOptions(`https://www.bilibili.com/video/${bvid}`)
    )
    return data.data ?? {}
  }

  async getPlayable(item: MusicItem): Promise<MusicPlayable> {
    const info = await this.resolveVideoInfo(item)
    if (!info.aid || !info.cid) {
      throw new Error('B站音频解析需要 aid 和 cid，请使用 音乐 <B站链接> 或重新搜索')
    }

    const playUrl = signedBilibiliAppUrl('https://api.bilibili.com/x/tv/playurl', bilibiliAppParams({
      cid: info.cid,
      object_id: info.aid
    }))
    const data = await this.requestJson<BilibiliPlayUrl>(playUrl, { defaultHeaders: false })
    const audio = selectBilibiliAudio(data)
    if (!audio) throw new Error('B站未返回可用音频流')

    return {
      item,
      audioUrl: audio.url,
      quality: String(audio.id)
    }
  }

  async fromLink(url: string): Promise<MusicItem> {
    const bvid = url.match(bvPattern)?.[0]
    if (!bvid) {
      return {
        id: url,
        source: 'bilibili',
        title: 'B站视频音频',
        artists: ['哔哩哔哩'],
        pageUrl: url
      }
    }

    const data = await this.requestJson<BilibiliVideoInfo>(
      `https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`,
      this.requestOptions(`https://www.bilibili.com/video/${bvid}`)
    )

    return {
      id: bvid,
      source: 'bilibili',
      title: data.data?.title || 'B站视频音频',
      artists: data.data?.owner?.name ? [data.data.owner.name] : ['哔哩哔哩'],
      coverUrl: data.data?.pic,
      durationSeconds: data.data?.duration,
      pageUrl: `https://www.bilibili.com/video/${bvid}`,
      raw: {
        ...data.data,
        aid: data.data?.aid,
        cid: data.data?.cid
      }
    }
  }
}
