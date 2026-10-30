import crypto from 'node:crypto'

import type { MusicItem, MusicPlayable, MusicProvider } from '@/music/types'
import { fetchJson } from '@/services/http'

import { normalizeDuration, providerError, requirePlayableUrl } from './helpers'
import { aggregatorAudioUrl, aggregatorSearch } from './aggregator'

type KuwoItem = {
  rid: number | string
  name: string
  artist?: string
  album?: string
  duration?: string | number
  pic?: string
}

type KuwoProviderOptions = {
  fetchJson?: <T = unknown>(url: string, options?: Parameters<typeof fetchJson>[1]) => Promise<T>
}

export class KuwoProvider implements MusicProvider {
  readonly source = 'kuwo' as const
  private readonly requestJson: NonNullable<KuwoProviderOptions['fetchJson']>

  constructor(options: KuwoProviderOptions = {}) {
    this.requestJson = options.fetchJson ?? fetchJson
  }

  async search(keyword: string, page: number, pageSize: number): Promise<MusicItem[]> {
    const url = `https://www.kuwo.cn/api/www/search/searchMusicBykeyWord?key=${encodeURIComponent(keyword)}&pn=${page}&rn=${pageSize}&httpsStatus=1`
    let data: { data?: { list?: KuwoItem[] } }
    try {
      data = await this.requestJson(url, {
        headers: {
          Referer: 'https://www.kuwo.cn/search/list'
        }
      })
    } catch (error) {
      // 酷我 www 接口要求 csrf/登录态，失败时交给聚合音源；聚合也没结果再报原始错误
      const aggregated = await aggregatorSearch('kuwo', keyword, page, pageSize, this.requestJson).catch(() => [])
      if (aggregated.length > 0) return aggregated
      throw providerError('酷我', error)
    }

    const items = (data.data?.list ?? []).map(item => ({
      id: String(item.rid),
      source: 'kuwo' as const,
      title: item.name,
      artists: item.artist ? [item.artist] : [],
      album: item.album,
      durationSeconds: normalizeDuration(item.duration),
      coverUrl: item.pic,
      pageUrl: `https://www.kuwo.cn/play_detail/${item.rid}`,
      raw: item
    }))

    if (items.length > 0) return items

    return aggregatorSearch('kuwo', keyword, page, pageSize, this.requestJson)
  }

  async getPlayable(item: MusicItem): Promise<MusicPlayable> {
    let audioUrl: string | undefined

    try {
      const data = await this.requestJson<{ data?: { url?: string } | string }>(`https://www.kuwo.cn/api/v1/www/music/playUrl?mid=${encodeURIComponent(item.id)}&type=convert_url&httpsStatus=1&reqId=${crypto.randomUUID()}`)
      audioUrl = typeof data.data === 'string' ? data.data : data.data?.url
    } catch {
      // 云崽兜底: 新版 playUrl 接口失败时改走 antiserver 的 convert_url3.
    }

    if (!audioUrl?.trim()) {
      // convert_url3 与云崽同参数: br=128kmp3, 返回 { url }.
      const legacyUrl = `http://antiserver.kuwo.cn/anti.s?useless=/resource/&format=mp3&rid=${encodeURIComponent(item.id)}&response=res&type=convert_url3&br=128kmp3`
      try {
        const legacy = await this.requestJson<{ url?: string }>(legacyUrl)
        audioUrl = legacy.url
      } catch {
        audioUrl = undefined
      }
    }

    if (audioUrl?.trim()) return { item, audioUrl: requirePlayableUrl(audioUrl) }

    const aggregatedUrl = await aggregatorAudioUrl(item, this.requestJson)
    if (aggregatedUrl) return { item, audioUrl: aggregatedUrl }

    throw new Error(`酷我：未获取到《${item.title}》的可播放链接（该歌曲可能已下架或需要会员）`)
  }

  async getLyrics(item: MusicItem): Promise<string | undefined> {
    const data = await this.requestJson<{ data?: { lrclist?: Array<{ lineLyric?: string }> } }>(`https://m.kuwo.cn/newh5/singles/songinfoandlrc?musicId=${encodeURIComponent(item.id)}`)
    const lines = data.data?.lrclist?.map(line => line.lineLyric).filter(Boolean) ?? []
    return lines.length > 0 ? lines.join('\n') : undefined
  }
}
