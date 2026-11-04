import { Config } from '@/config'
import { fetchJson } from '@/services/http'
import type { MusicItem, MusicSource } from '@/music/types'

/**
 * txqq.pro 聚合音源：一次请求同时给搜索结果和音频直链，覆盖 QQ音乐/网易云/酷狗/酷我。
 * 作为各平台原生接口的兜底——原生接口失效（登录态收紧、第三方 API 下线）时仍然能出歌。
 */
type AggregatorSong = {
  songid?: string | number
  title?: string
  author?: string
  url?: string
  link?: string
  pic?: string
  lrc?: string
}

const platformType: Partial<Record<MusicSource, string>> = {
  qq: 'qq',
  netease: 'netease',
  kugou: 'kugou',
  kuwo: 'kuwo'
}

const aggregatorUrl = () => Config.music.api.aggregatorUrl?.trim() || ''

const isEnabled = () => Boolean(Config.music.api.aggregatorEnabled) && aggregatorUrl().startsWith('http')

/** 只认标题完全一致的命中，避免兜底搜出别的歌还照发 */
const normalizeText = (value: string) => value.toLowerCase().replace(/[\s\-_/（）()【】[\]·,，.。!！?？'"]/g, '')

type RequestJson = <T = unknown>(url: string, options?: Parameters<typeof fetchJson>[1]) => Promise<T>

type CacheEntry = { at: number, songs: AggregatorSong[] }

/** 单次请求超时、兜底查询总预算、结果缓存：上游不稳，既别把命令拖死，也别把人家打爆 */
const requestTimeoutMs = 5_000
const overallBudgetMs = 6_000
const cacheTtlMs = 120_000
const cache = new Map<string, CacheEntry>()

const cacheKey = (type: string, keyword: string) => `${type}:${keyword.trim().toLowerCase()}`

/** 清空结果缓存（测试用，也方便排查"改了配置但结果没变"这类错觉） */
export const resetAggregatorCache = () => cache.clear()

const request = async (keyword: string, type: string, page: number, requestJson: RequestJson, timeoutMs = requestTimeoutMs): Promise<AggregatorSong[]> => {
  const base = aggregatorUrl()
  if (!base) return []

  const key = cacheKey(type, keyword)
  const cached = cache.get(key)
  if (cached && Date.now() - cached.at < cacheTtlMs) return cached.songs

  const origin = new URL(base).origin
  const body = new URLSearchParams({
    input: keyword,
    filter: 'name',
    type,
    page: String(page)
  })

  const data = await requestJson<{ data?: AggregatorSong[] }>(base, {
    method: 'POST',
    body: body.toString(),
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'X-Requested-With': 'XMLHttpRequest',
      Origin: origin,
      Referer: base
    },
    timeoutMs,
    maxBytes: 512 * 1024
  })

  const songs = Array.isArray(data?.data) ? data.data : []
  // 只缓存有结果的成功响应，空结果多半是上游抖动，不固化
  if (songs.length > 0) {
    cache.set(key, { at: Date.now(), songs })
    if (cache.size > 200) {
      const oldest = [...cache.entries()].sort((a, b) => a[1].at - b[1].at)[0]
      if (oldest) cache.delete(oldest[0])
    }
  }

  return songs
}

export const aggregatorSearch = async (source: MusicSource, keyword: string, page: number, pageSize: number, requestJson: RequestJson = fetchJson): Promise<MusicItem[]> => {
  const type = platformType[source]
  if (!type || !isEnabled()) return []

  try {
    const songs = await request(keyword, type, page, requestJson)
    return songs
      // 没有音频直链的结果没法发卡（例如酷我整站直链都拿不到），直接丢掉，避免发出坏卡
      .filter(song => isAudioUrl(song.url))
      .slice(0, pageSize)
      .map(song => ({
        id: String(song.songid ?? ''),
        source,
        title: song.title || '未知歌曲',
        artists: song.author ? [song.author] : [],
        coverUrl: song.pic || undefined,
        pageUrl: song.link || String(song.url),
        raw: { aggregator: true, aggregatorUrl: song.url }
      }))
      .filter(item => item.id && item.pageUrl)
  } catch {
    return []
  }
}

const isAudioUrl = (value: unknown): value is string => typeof value === 'string' && /^https?:\/\//i.test(value)

/** 拿音频直链：搜索结果自带就直接用，否则按「标题 + 歌手」再查一次并要求标题对得上 */
export const aggregatorAudioUrl = async (item: MusicItem, requestJson: RequestJson = fetchJson): Promise<string | undefined> => {
  const cached = (item.raw as { aggregatorUrl?: string } | undefined)?.aggregatorUrl
  if (isAudioUrl(cached)) return cached

  const type = platformType[item.source]
  if (!type || !isEnabled()) return undefined

  const keywords = [
    [item.title, ...item.artists].filter(Boolean).join(' '),
    item.title
  ].filter((keyword, index, list) => keyword && list.indexOf(keyword) === index)

  const targetTitle = normalizeText(item.title)
  const targetArtists = item.artists.map(normalizeText).filter(Boolean)

  const sameArtist = (song: AggregatorSong) => {
    const author = normalizeText(song.author || '')
    return Boolean(author) && targetArtists.some(artist => artist && (author.includes(artist) || artist.includes(author)))
  }

  const startedAt = Date.now()
  const withinBudget = () => Date.now() - startedAt < overallBudgetMs
  // 剩余预算算进单次请求超时，保证「已经在飞的请求」也不会突破整体预算
  const remainingBudgetTimeout = () => Math.max(1000, Math.min(requestTimeoutMs, overallBudgetMs - (Date.now() - startedAt)))

  for (const keyword of keywords) {
    // 聚合音源偶发空结果（上游不稳定），重试有上限，且整体不超过预算，别把点歌拖成几十秒
    for (let attempt = 1; attempt <= 2 && withinBudget(); attempt += 1) {
      try {
        const songs = await request(keyword, type, 1, requestJson, remainingBudgetTimeout())
        const usable = songs.filter(song => isAudioUrl(song.url))
        const exact = usable.filter(song => normalizeText(song.title || '') === targetTitle)
        // 标题带后缀的版本（「晴天 (女声独唱版)」）只在没有精确命中时才接受
        const prefixed = usable.filter(song => normalizeText(song.title || '').startsWith(targetTitle))
        const candidates = exact.length > 0 ? exact : prefixed
        if (candidates.length === 0) {
          await new Promise(resolve => setTimeout(resolve, 120))
          continue
        }

        return (candidates.find(sameArtist) ?? candidates[0])!.url
      } catch {
        await new Promise(resolve => setTimeout(resolve, 120))
      }
    }
  }

  return undefined
}
