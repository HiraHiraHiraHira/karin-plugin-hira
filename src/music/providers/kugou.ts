import type { MusicItem, MusicPlayable, MusicProvider } from '@/music/types'
import { fetchJson } from '@/services/http'

import { normalizeDuration, requirePlayableUrl } from './helpers'

type KugouSearchItem = {
  hash: string
  filename?: string
  songname?: string
  singername?: string
  duration?: number
  imgurl?: string
}

type KugouProviderOptions = {
  fetchJson?: <T = unknown>(url: string, options?: Parameters<typeof fetchJson>[1]) => Promise<T>
}

export class KugouProvider implements MusicProvider {
  readonly source = 'kugou' as const
  private readonly requestJson: NonNullable<KugouProviderOptions['fetchJson']>

  constructor(options: KugouProviderOptions = {}) {
    this.requestJson = options.fetchJson ?? fetchJson
  }

  async search(keyword: string, page: number, pageSize: number): Promise<MusicItem[]> {
    const url = `https://mobiles.kugou.com/api/v3/search/song?format=json&keyword=${encodeURIComponent(keyword)}&page=${page}&pagesize=${pageSize}&showtype=1`
    const data = await this.requestJson<{ data?: { info?: KugouSearchItem[] } }>(url)

    return (data.data?.info ?? []).map(item => ({
      id: item.hash,
      source: 'kugou',
      title: item.songname || item.filename || '未知歌曲',
      artists: item.singername ? [item.singername] : [],
      durationSeconds: normalizeDuration(item.duration),
      coverUrl: item.imgurl?.replace('/{size}', ''),
      pageUrl: `https://www.kugou.com/song/#hash=${item.hash}`,
      raw: item
    }))
  }

  async getPlayable(item: MusicItem): Promise<MusicPlayable> {
    const data = await this.requestJson<{ url?: string, fileName?: string }>(`https://m.kugou.com/app/i/getSongInfo.php?hash=${encodeURIComponent(item.id)}&cmd=playInfo`)

    return {
      item: {
        ...item,
        title: data.fileName || item.title
      },
      audioUrl: requirePlayableUrl(data.url)
    }
  }

  async getLyrics(item: MusicItem): Promise<string | undefined> {
    const data = await this.requestJson<{ lyrics?: string }>(`https://m.kugou.com/app/i/getSongInfo.php?hash=${encodeURIComponent(item.id)}&cmd=playInfo`)
    return data.lyrics?.trim() || undefined
  }
}
