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

type QQFileInfo = {
  media_mid?: string
  size_320mp3?: number
  size_192ogg?: number
  size_128mp3?: number
  size_96aac?: number
}

type QQSearchSong = {
  mid?: string
  songmid?: string
  id?: number
  songid?: number
  name?: string
  songname?: string
  title?: string
  singer?: Array<{ name?: string }>
  album?: { name?: string, pmid?: string, mid?: string }
  interval?: number
  file?: QQFileInfo
  pay?: { price_track?: number, pay_play?: number }
  sa?: number
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

/**
 * 直链缓存：vkey 有有效期（数小时），10 分钟内复用是安全的。
 * 同一首歌被反复点（或列表里来回选）时省掉一次 vkey + 聚合查询。
 */
const playableCache = new Map<string, { at: number, audioUrl: string }>()
const playableCacheTtlMs = 10 * 60_000
const playableCacheMax = 300

export const resetQQPlayableCache = () => playableCache.clear()

const playableCacheKey = (item: MusicItem) => {
  const aggregator = (item.raw as { aggregatorUrl?: string } | undefined)?.aggregatorUrl
  return `${item.id}:${aggregator ? 'aggregator' : 'native'}`
}

const readPlayableCache = (item: MusicItem) => {
  const entry = playableCache.get(playableCacheKey(item))
  if (!entry) return undefined
  if (Date.now() - entry.at > playableCacheTtlMs) {
    playableCache.delete(playableCacheKey(item))
    return undefined
  }
  return entry.audioUrl
}

const writePlayableCache = (item: MusicItem, audioUrl: string) => {
  playableCache.set(playableCacheKey(item), { at: Date.now(), audioUrl })
  if (playableCache.size > playableCacheMax) {
    const oldest = [...playableCache.entries()].sort((a, b) => a[1].at - b[1].at)[0]
    if (oldest) playableCache.delete(oldest[0])
  }
}

const asRecord = (value: unknown): Record<string, unknown> => {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {}
}

/** 搜索结果、每日推荐、电台、收藏的歌曲结构一致, 共用同一份映射. */
export const normalizeQQTracks = (tracks: QQSearchSong[] | undefined): MusicItem[] => {
  return (tracks ?? []).map(item => {
    const mid = item.mid || item.songmid || String(item.id ?? item.songid ?? '')
    const albumMid = item.album?.pmid || item.album?.mid || ''
    return {
      id: mid,
      source: 'qq' as const,
      title: item.name || item.songname || item.title || '未知歌曲',
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

/** 官方桌面搜索的返回结构：req_1.data.body.song.list[] */
export const normalizeQQSearchResult = (payload: unknown): MusicItem[] => {
  const root = asRecord(payload)
  const req = asRecord(root.req_1)
  const data = asRecord(req.data)
  const body = asRecord(data.body)
  const song = asRecord(body.song)
  const list = Array.isArray(song.list) ? song.list as QQSearchSong[] : []

  return normalizeQQTracks(list)
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

export const normalizeQQCookieStatus = (payload: unknown, vip?: boolean) => {
  const data = asRecord(payload)
  const profile = data.data as QQProfileResponse['data'] | undefined
  const nick = profile?.creator?.nick?.trim()
  if (data.code === 0 && nick) {
    return { ok: true, message: nick, ...(vip === undefined ? {} : { vip }) }
  }
  return { ok: false, message: 'Cookie 失效或未登录' }
}

const qqCookieValue = (cookie: string, keys: string[]) => {
  for (const part of cookie.split(';')) {
    const [key, ...rest] = part.split('=')
    if (keys.includes(key.trim().toLowerCase())) return rest.join('=').trim()
  }
  return undefined
}

/** QQ 音乐个性化接口需要 uin; 微信登录的 Cookie 只有 wxuin. */
export const parseQQCookieUin = (cookie: string) => qqCookieValue(cookie, ['uin', 'wxuin'])

const qqCookieMusicKey = (cookie: string) => qqCookieValue(cookie, ['qm_keyst', 'qqmusic_key'])

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

/** 云崽的音质阶梯: 320mp3 > 192ogg > 128mp3 > 96aac, 请求时按可用档位一次全带上. */
const qqQualityTiers: Array<[keyof QQFileInfo, string, string]> = [
  ['size_320mp3', 'M800', 'mp3'],
  ['size_192ogg', 'O600', 'ogg'],
  ['size_128mp3', 'M500', 'mp3'],
  ['size_96aac', 'C400', 'm4a']
]

/**
 * 文件名必须用 file.media_mid(部分歌曲与 songmid 不同), 否则 vkey 返回空 purl.
 * 档位信息缺失时(例如只有搜索结果 mid)退回 320mp3 单档.
 */
export const buildQQVkeyFilenames = (songmid: string, file?: QQFileInfo) => {
  const mediaMid = file?.media_mid?.trim() || songmid
  const filenames = qqQualityTiers
    .filter(([sizeKey]) => Number(file?.[sizeKey] ?? 0) > 0)
    .map(([, prefix, ext]) => `${prefix}${mediaMid}.${ext}`)
  return filenames.length > 0 ? filenames : [`M800${mediaMid}.mp3`]
}

const buildQQVkeyBody = (songmid: string, file?: QQFileInfo) => {
  const filenames = buildQQVkeyFilenames(songmid, file)
  return {
    req_0: {
      module: 'vkey.GetVkeyServer',
      method: 'CgiGetVkey',
      param: {
        guid: '10000',
        songmid: filenames.map(() => songmid),
        songtype: filenames.map(() => 0),
        uin: '0',
        loginflag: 1,
        platform: '20',
        filename: filenames
      }
    }
  }
}

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
      // 云崽行为: 搜索失败就是没有结果, 由调用方回 "没有找到歌曲！", 不伪造列表.
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
    // 官方接口未登录态常返回空、旧接口不需要登录态：两者并行发，官方结果优先，
    // 这样失败时不用再串行等第二次请求，点歌响应能省 1~2 秒
    const [official, legacy] = await Promise.all([
      this.searchOfficial(keyword, page, pageSize),
      this.searchLegacy(keyword, page, pageSize)
    ])
    if (official.length > 0) return official
    if (legacy.length > 0) return legacy

    const aggregated = await aggregatorSearch('qq', keyword, page, pageSize, this.requestJson)
    if (aggregated.length > 0) return aggregated

    // 三个搜索接口都没结果时直接报错：以前会退化成「青花瓷 #1」这种假 id 的占位列表，
    // 用户点进去才在取直链时报错，反而更难理解
    throw new Error('QQ音乐搜索暂时不可用，可以试试「#网易点歌 歌名」或稍后再试')
  }

  private async resolvePlayable(item: MusicItem): Promise<MusicPlayable> {
    const track = item.raw as QQSearchSong | undefined
    try {
      const data = await this.requestJson(musicuUrl, {
        method: 'POST',
        body: JSON.stringify(buildQQVkeyBody(item.id, track?.file)),
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

    if (!this.tempApi) throw new Error(`QQ音乐：未获取到《${item.title}》的可播放链接（可能需要配置 Cookie 或该歌曲需付费）`)
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

  async getPlayable(item: MusicItem): Promise<MusicPlayable> {
    const cached = readPlayableCache(item)
    if (cached) return { item, audioUrl: cached }
    const playable = await this.resolvePlayable(item)
    writePlayableCache(item, playable.audioUrl)
    return playable
  }

  async getLyrics(item: MusicItem): Promise<string[]> {
    const url = `https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg?songmid=${encodeURIComponent(item.id)}&format=json&nobase64=0`
    const data = await this.requestJson<{ lyric?: string, trans?: string }>(url, {
      headers: {
        Referer: 'https://y.qq.com/',
        ...(this.cookie ? { Cookie: this.cookie } : {})
      }
    })
    const lyric = decodeQQLyric(data.lyric)
    const trans = decodeQQLyric(data.trans)
    // 原文/翻译分段返回, 由发送侧各自转发(云崽行为).
    return [lyric, trans].filter((value): value is string => Boolean(value?.trim()))
  }

  async checkCookie() {
    if (!this.cookie.trim()) return { ok: false, message: '未配置 Cookie' }
    const data = await this.requestJson<unknown>(profileUrl, {
      headers: {
        Referer: 'https://y.qq.com/',
        Cookie: this.cookie
      }
    })
    const uin = parseQQCookieUin(this.cookie)
    return normalizeQQCookieStatus(data, uin ? await this.isVip(uin) : undefined)
  }

  /** QQ 音乐 VIP 判定, 失败按非 VIP 处理(状态回显不应因 VIP 查询失败而报错). */
  async isVip(uin: string) {
    try {
      const data = await this.requestJson<{ req_0?: { code?: string | number, data?: { infoMap?: Record<string, { iVipFlag?: number, iSuperVip?: number, iNewVip?: number, iNewSuperVip?: number }> } } }>(musicuUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          ...(this.cookie ? { Cookie: this.cookie } : {})
        },
        body: JSON.stringify({
          comm: { cv: 4747474, ct: 24, format: 'json', inCharset: 'utf-8', outCharset: 'utf-8', notice: 0, platform: 'yqq.json', needNewCode: 1, uin: 0, g_tk_new_20200303: 5381, g_tk: 5381 },
          req_0: { module: 'userInfo.VipQueryServer', method: 'SRFVipQuery_V2', param: { uin_list: [uin] } }
        })
      })
      if (String(data.req_0?.code ?? '0') !== '0') return false
      const info = data.req_0?.data?.infoMap?.[uin]
      if (!info) return false
      return [info.iVipFlag, info.iSuperVip, info.iNewVip, info.iNewSuperVip].some(flag => flag === 1)
    } catch {
      return false
    }
  }

  private requirePersonalizedCookie(action: string) {
    if (!this.cookie.trim()) {
      throw new Error(`QQ音乐：${action}需要先配置 Cookie（发送 #提交音乐ck 粘贴 QQ 音乐 Cookie）`)
    }
    const uin = parseQQCookieUin(this.cookie)
    if (!uin) {
      throw new Error(`QQ音乐：${action}的 Cookie 缺少 uin/wxuin，请重新获取完整 Cookie`)
    }
    return uin
  }

  private async requestMusicu<T>(req: Record<string, unknown>, uin: string) {
    return this.requestJson<T>(musicuUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Referer: 'https://y.qq.com/',
        ...(this.cookie ? { Cookie: this.cookie } : {})
      },
      body: JSON.stringify({
        comm: {
          g_tk: 5381,
          uin,
          format: 'json',
          ct: 20,
          cv: 1803,
          platform: 'wk_v17',
          guid: crypto.createHash('md5').update(String(Date.now())).digest('hex'),
          tmeLoginType: 2,
          psrf_qqunionid: '',
          authst: qqCookieMusicKey(this.cookie) ?? ''
        },
        ...req
      })
    })
  }

  /** 云崽 dirid: 201=我喜欢, 202=每日推荐. */
  private async getDissTracks(dirid: number, page: number, pageSize: number) {
    const uin = this.requirePersonalizedCookie(dirid === 202 ? '每日推荐' : '我的收藏')
    const data = await this.requestMusicu<{ req_0?: { code?: string | number, data?: { songlist?: QQSearchSong[] } } }>({
      req_0: {
        module: 'srf_diss_info.DissInfoServer',
        method: 'CgiGetDiss',
        param: {
          disstid: 0,
          dirid,
          onlysonglist: 0,
          song_begin: (Math.max(page, 1) - 1) * pageSize,
          song_num: pageSize,
          userinfo: 1,
          pic_dpi: 800,
          orderlist: 1
        }
      }
    }, uin)
    if (String(data.req_0?.code ?? '0') !== '0') {
      throw new Error(`QQ音乐：${dirid === 202 ? '每日推荐' : '收藏'}获取失败（登录态可能已失效）`)
    }
    return normalizeQQTracks(data.req_0?.data?.songlist)
  }

  async getPersonalized(kind: 'dailyRecommend' | 'radio' | 'favorites' | 'random', options?: { page?: number, pageSize?: number }) {
    const page = options?.page ?? 1
    const pageSize = options?.pageSize ?? 20

    if (kind === 'favorites') return this.getDissTracks(201, page, pageSize)
    if (kind === 'dailyRecommend') return this.getDissTracks(202, page, pageSize)

    if (kind === 'radio') {
      const uin = this.requirePersonalizedCookie('个性电台')
      const data = await this.requestMusicu<{ req_0?: { code?: string | number, data?: { tracks?: QQSearchSong[] } } }>({
        req_0: { method: 'get_radio_track', module: 'pc_track_radio_svr', param: { id: 99, num: pageSize } }
      }, uin)
      if (String(data.req_0?.code ?? '0') !== '0') {
        throw new Error('QQ音乐：个性电台获取失败（登录态可能已失效）')
      }
      return normalizeQQTracks(data.req_0?.data?.tracks)
    }

    const uin = this.requirePersonalizedCookie('每日推荐')
    const feed = await this.requestMusicu<{ req_0?: { code?: string | number, data?: { v_shelf?: Array<{ style?: number, v_niche?: Array<{ v_card?: Array<{ id?: number | string }> }> }> } } }>({
      req_0: { module: 'recommend.RecommendFeedServer', method: 'get_recommend_feed', param: { direction: 1, page: 1, v_cache: [], v_uniq: [], s_num: 0 } }
    }, uin)
    if (String(feed.req_0?.code ?? '0') !== '0') {
      throw new Error('QQ音乐：获取推荐歌曲失败，请重试')
    }

    const ids: string[] = []
    for (const shelf of feed.req_0?.data?.v_shelf ?? []) {
      if (shelf.style !== 1) continue
      for (const niche of shelf.v_niche ?? []) {
        for (const card of niche.v_card ?? []) {
          if (card.id !== undefined && ids.length < pageSize) ids.push(String(card.id))
        }
      }
    }
    if (ids.length === 0) throw new Error('QQ音乐：获取推荐歌曲失败，请重试')

    const data = await this.requestMusicu<{ req_0?: { code?: string | number, data?: { tracks?: QQSearchSong[] } } }>({
      req_0: {
        module: 'track_info.UniformRuleCtrlServer',
        method: 'GetTrackInfo',
        param: { ids: ids.map(Number), types: ids.map(() => 200) }
      }
    }, uin)
    const tracks = normalizeQQTracks(data.req_0?.data?.tracks)
    if (tracks.length === 0) throw new Error('QQ音乐：获取推荐歌曲失败，请重试')
    return [tracks[Math.floor(Math.random() * tracks.length)]]
  }
}
