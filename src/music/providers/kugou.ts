import type { MusicItem, MusicPlayable, MusicProvider } from '@/music/types'
import { fetchJson } from '@/services/http'

import { normalizeDuration, providerError, requirePlayableUrl } from './helpers'
import { aggregatorAudioUrl, aggregatorSearch } from './aggregator'

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
    let data: { data?: { info?: KugouSearchItem[] } }
    try {
      data = await this.requestJson(url)
    } catch (error) {
      // 原生搜索失败时交给聚合音源；聚合也没有结果再把原始错误报给用户
      const aggregated = await aggregatorSearch('kugou', keyword, page, pageSize, this.requestJson).catch(() => [])
      if (aggregated.length > 0) return aggregated
      throw providerError('酷狗', error)
    }

    const items = (data.data?.info ?? []).map(item => ({
      id: item.hash,
      source: 'kugou' as const,
      title: item.songname || item.filename || '未知歌曲',
      artists: item.singername ? [item.singername] : [],
      durationSeconds: normalizeDuration(item.duration),
      coverUrl: item.imgurl?.replace('/{size}', ''),
      pageUrl: `https://www.kugou.com/song/#hash=${item.hash}`,
      raw: item
    }))

    if (items.length > 0) return items

    return aggregatorSearch('kugou', keyword, page, pageSize, this.requestJson)
  }

  async getPlayable(item: MusicItem): Promise<MusicPlayable> {
    let data: { url?: string, fileName?: string } | undefined
    try {
      data = await this.requestJson(`https://m.kugou.com/app/i/getSongInfo.php?hash=${encodeURIComponent(item.id)}&cmd=playInfo`)
    } catch {
      // 该接口现在常只回元数据不回直链，落到聚合音源
      data = undefined
    }

    if (data?.url && /^https?:/i.test(data.url)) {
      return {
        item: {
          ...item,
          // fileName 形如「周杰伦 - 青花瓷」，直接当标题会变成「周杰伦 - 青花瓷 - 周杰伦」
          title: data.fileName && !data.fileName.includes(' - ') ? data.fileName : item.title
        },
        audioUrl: requirePlayableUrl(data.url)
      }
    }

    const aggregatedUrl = await aggregatorAudioUrl(item, this.requestJson)
    if (aggregatedUrl) return { item, audioUrl: aggregatedUrl }

    throw new Error(`酷狗：未获取到《${item.title}》的可播放链接（该歌曲可能已下架或需要会员）`)
  }

  async getLyrics(item: MusicItem): Promise<string | undefined> {
    const data = await this.requestJson<{ lyrics?: string }>(`https://m.kugou.com/app/i/getSongInfo.php?hash=${encodeURIComponent(item.id)}&cmd=playInfo`)
    return data.lyrics?.trim() || undefined
  }
}
