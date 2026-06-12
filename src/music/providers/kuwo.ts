import type { MusicItem, MusicPlayable, MusicProvider } from '@/music/types'
import { fetchJson } from '@/services/http'

import { normalizeDuration, requirePlayableUrl } from './helpers'

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
    const data = await this.requestJson<{ data?: { list?: KuwoItem[] } }>(url, {
      headers: {
        Referer: 'https://www.kuwo.cn/search/list'
      }
    })

    return (data.data?.list ?? []).map(item => ({
      id: String(item.rid),
      source: 'kuwo',
      title: item.name,
      artists: item.artist ? [item.artist] : [],
      album: item.album,
      durationSeconds: normalizeDuration(item.duration),
      coverUrl: item.pic,
      pageUrl: `https://www.kuwo.cn/play_detail/${item.rid}`,
      raw: item
    }))
  }

  async getPlayable(item: MusicItem): Promise<MusicPlayable> {
    const data = await this.requestJson<{ data?: { url?: string } | string }>(`https://www.kuwo.cn/api/v1/www/music/playUrl?mid=${encodeURIComponent(item.id)}&type=convert_url&httpsStatus=1`)
    const audioUrl = typeof data.data === 'string' ? data.data : data.data?.url

    return {
      item,
      audioUrl: requirePlayableUrl(audioUrl)
    }
  }

  async getLyrics(item: MusicItem): Promise<string | undefined> {
    const data = await this.requestJson<{ data?: { lrclist?: Array<{ lineLyric?: string }> } }>(`https://m.kuwo.cn/newh5/singles/songinfoandlrc?musicId=${encodeURIComponent(item.id)}`)
    const lines = data.data?.lrclist?.map(line => line.lineLyric).filter(Boolean) ?? []
    return lines.length > 0 ? lines.join('\n') : undefined
  }
}
