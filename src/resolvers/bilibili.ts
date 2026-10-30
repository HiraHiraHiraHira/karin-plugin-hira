import { Config } from '@/config'
import { fetchResolverJson, resolveResolverRedirectUrl } from '@/services/resolverHttp'
import type { ResolverConfig } from '@/types/config'

import { logResolverStage } from './resolverLog'
import type { ResolvedPost, ResolverFailure, ResolverResult, ResolverVideo, RichContentBlock } from './types'

const failure = (reason: string): ResolverFailure => ({
  platform: 'bilibili',
  displayName: '哔哩哔哩',
  ok: false,
  reason
})

const asObject = (value: unknown): Record<string, any> | undefined => {
  return typeof value === 'object' && value !== null ? value as Record<string, any> : undefined
}

const stringArray = (value: unknown) => {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && Boolean(item.trim())) : []
}

const bilibiliUserAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

const BILIBILI_VIDEO_INFO = 'https://api.bilibili.com/x/web-interface/view'
const BILIBILI_PLAY_URL = 'https://api.bilibili.com/x/player/playurl'
const BILIBILI_ONLINE = 'https://api.bilibili.com/x/player/online/total'
const BILIBILI_EP_INFO = 'https://api.bilibili.com/pgc/view/web/season'
const BILIBILI_SEASON_SECTION = 'https://api.bilibili.com/pgc/web/season/section'
const BILIBILI_BANGUMI_PLAY_URL = 'https://api.bilibili.com/pgc/player/web/playurl'
const BILIBILI_ARTICLE_INFO = 'https://api.bilibili.com/x/article/viewinfo'
const BILIBILI_LIVE_INFO = 'https://api.live.bilibili.com/room/v1/Room/get_info'
const BILIBILI_OPUS_DETAIL = 'https://api.bilibili.com/x/polymer/web-dynamic/v1/opus/detail'

const bvidPattern = /BV[0-9A-Za-z]{10}/i

export const extractBvid = (url: string) => {
  return url.match(bvidPattern)?.[0]
}

/** `video/av170001` 形式的旧 av 号: view 接口支持 `aid=` 入参, 返回体里带 bvid。 */
export const extractBilibiliAid = (url: string) => {
  try {
    return new URL(url).pathname.match(/\/video\/av(\d+)/i)?.[1]
  } catch {
    return url.match(/\/video\/av(\d+)/i)?.[1]
  }
}

/** `?p=2` 分P：B站 view 接口按 bvid 返回默认分P，cid 决定实际拉取哪一P。 */
export const extractBilibiliPage = (url: string) => {
  try {
    const page = Number(new URL(url).searchParams.get('p'))
    return Number.isInteger(page) && page > 0 ? page : 1
  } catch {
    return 1
  }
}

export const isBilibiliShortUrl = (url: string) => {
  try {
    const hostname = new URL(url).hostname.toLowerCase()
    return hostname === 'b23.tv' || hostname === 'bili2233.cn' || hostname.endsWith('.b23.tv') || hostname.endsWith('.bili2233.cn')
  } catch {
    return false
  }
}

export type BilibiliTarget =
  | { kind: 'video', bvid?: string, aid?: string, page: number }
  | { kind: 'bangumi', epId?: string, seasonId?: string }
  | { kind: 'dynamic', dynamicId: string }
  | { kind: 'article', cvid: string }
  | { kind: 'live', roomId: string }

/**
 * 链接形态分派。顺序即优先级: 直播号是纯数字, 若放在最后会被 `/video/...` 之类的宽松规则截走,
 * 因此先判 live/read/opus 等专用路径, 再落到普通视频。
 */
export const classifyBilibiliUrl = (url: string): BilibiliTarget | undefined => {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return undefined
  }

  const hostname = parsed.hostname.toLowerCase()
  const path = parsed.pathname

  if (hostname === 'live.bilibili.com' || hostname.endsWith('.live.bilibili.com')) {
    const roomId = path.match(/^\/(?:blanc\/)?(\d+)/)?.[1]
    return roomId ? { kind: 'live', roomId } : undefined
  }

  const epId = path.match(/\/bangumi\/play\/ep(\d+)/i)?.[1]
  if (epId) return { kind: 'bangumi', epId }
  const seasonId = path.match(/\/bangumi\/play\/ss(\d+)/i)?.[1]
  if (seasonId) return { kind: 'bangumi', seasonId }

  const cvid = path.match(/\/read\/cv(\d+)/i)?.[1] || (path.includes('/read/mobile') ? parsed.searchParams.get('id') : undefined)
  if (cvid && /^\d+$/.test(cvid)) return { kind: 'article', cvid }

  const dynamicId = hostname === 't.bilibili.com'
    ? path.match(/^\/(\d+)/)?.[1]
    : path.match(/\/(?:opus|dynamic)\/(\d+)/)?.[1]
  if (dynamicId) return { kind: 'dynamic', dynamicId }

  const bvid = extractBvid(url)
  if (bvid) return { kind: 'video', bvid, page: extractBilibiliPage(url) }
  const aid = extractBilibiliAid(url)
  if (aid) return { kind: 'video', aid, page: extractBilibiliPage(url) }
  return undefined
}

const bilibiliCookieHeader = (cookie: string) => {
  const value = cookie.trim()
  if (!value) return undefined
  return /SESSDATA\s*=/i.test(value) ? value : `SESSDATA=${value}`
}

const formatStat = (label: string, value: unknown) => {
  return typeof value === 'number' && Number.isFinite(value) ? `${label}：${value}` : ''
}

const formatStats = (stat: Record<string, any> | undefined) => [
  formatStat('播放', stat?.view),
  formatStat('点赞', stat?.like),
  formatStat('硬币', stat?.coin),
  formatStat('收藏', stat?.favorite),
  formatStat('分享', stat?.share),
  formatStat('弹幕', stat?.danmaku),
  formatStat('评论', stat?.reply)
].filter(Boolean).join(' | ')

const mediaFallbackMessage = '视频资源暂不可用，已降级为封面和原链接。'

const appendDescription = (result: ResolvedPost, message: string): ResolvedPost => ({
  ...result,
  description: [result.description, message].filter(Boolean).join('\n')
})

type BilibiliCodecPreference = ResolverConfig['bilibili']['codec']

const validCodecPreferences = new Set(['auto', 'av1', 'hevc', 'avc'])

const normalizeNumber = (value: unknown, fallback: number) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

const normalizeCodecPreference = (value: unknown): BilibiliCodecPreference => {
  const codec = String(value || 'auto')
  return validCodecPreferences.has(codec) ? codec as BilibiliCodecPreference : 'auto'
}

const codecFamily = (codecs: string) => {
  const value = codecs.toLowerCase()
  if (value.includes('av01') || value.includes('av1')) return 'av1'
  if (value.includes('hev1') || value.includes('hvc1') || value.includes('hevc')) return 'hevc'
  if (value.includes('avc1') || value.includes('avc')) return 'avc'
  return 'unknown'
}

/**
 * 编码优先级表与 R 插件一致: 指定编码排第一, 其余按 av1 > hevc > avc 降级。
 * auto 时 av1 最优先(体积最小), 只有在接口真的下发 AV1 流时才可能命中。
 */
const codecRanks: Record<BilibiliCodecPreference, Record<string, number>> = {
  auto: { av1: 0, hevc: 1, avc: 2, unknown: 3 },
  av1: { av1: 0, hevc: 1, avc: 2, unknown: 3 },
  hevc: { av1: 1, hevc: 0, avc: 2, unknown: 3 },
  avc: { av1: 1, hevc: 2, avc: 0, unknown: 3 }
}

const codecPreferenceRank = (codecs: string, preference: BilibiliCodecPreference) => {
  return codecRanks[preference][codecFamily(codecs)] ?? 3
}

// mcdn 一类节点会限速甚至直接挂起, 拿到直链后必须在发出前换掉。
const slowCdnHostPatterns = ['.mcdn.bilivideo.cn', 'mountaintoys.cn', '.szbdyd.com']
const fastCdnHostPatterns = [
  /^cn-[a-z]+-[a-z]+-\d+-\d+\.bilivideo\.com$/,
  /^upos-sz-mirror.*\.bilivideo\.com$/,
  /^upos-hz-mirror.*\.bilivideo\.com$/
]

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.toLowerCase()
  } catch {
    return ''
  }
}

const replaceBilibiliP2PUrl = (url: string) => {
  try {
    const parsed = new URL(url)
    const host = parsed.hostname
    if (/upos-sz-mirror08[ch]\.bilivideo\.com/.test(host) || /upos-hz-mirrorakam\.akamaized\.net/.test(host)) {
      parsed.host = 'upos-sz-mirrorhwo1.bilivideo.com'
    } else if (/upos-sz-estgoss\.bilivideo\.com/.test(host) || /upos-sz-mirrorali(?:ov|b)?\.bilivideo\.com/.test(host)) {
      parsed.host = 'upos-sz-mirroralio1.bilivideo.com'
    } else if (host.endsWith('.mcdn.bilivideo.cn') || /cn(?:-[a-z]+){2}(?:-\d{2}){2}\.bilivideo\.com/.test(host)) {
      parsed.host = 'upos-sz-mirrorcoso1.bilivideo.com'
    } else if (host.endsWith('.szbdyd.com')) {
      const source = parsed.searchParams.get('xy_usource')
      if (!source) return url
      parsed.host = source
    } else {
      return url
    }
    return parsed.toString()
  } catch {
    return url
  }
}

/**
 * 直链节点选择: 快速 CDN 原样使用, 慢速 CDN 优先从 backupUrl 里挑, 都慢才改写为源站镜像。
 * 只在 resolve 阶段做 URL 级替换, 不触碰媒体内容。
 */
export const selectBilibiliCdnUrl = (baseUrl: string, backupUrls: string[] = []) => {
  if (!baseUrl) return baseUrl
  const host = hostOf(baseUrl)
  if (!host) return baseUrl
  const isSlow = slowCdnHostPatterns.some(pattern => host.includes(pattern))
  const isFast = fastCdnHostPatterns.some(pattern => pattern.test(host))
  if (isFast || !isSlow) return baseUrl

  const fastBackup = backupUrls.find(url => fastCdnHostPatterns.some(pattern => pattern.test(hostOf(url))))
  if (fastBackup) return fastBackup
  const healthyBackup = backupUrls.find(url => {
    const backupHost = hostOf(url)
    return Boolean(backupHost) && !slowCdnHostPatterns.some(pattern => backupHost.includes(pattern))
  })
  if (healthyBackup) return healthyBackup
  return replaceBilibiliP2PUrl(baseUrl) || baseUrl
}

const streamUrlOf = (value: unknown) => {
  const item = asObject(value)
  if (!item) return undefined
  const primary = [item.url, item.baseUrl, item.base_url]
    .find((candidate): candidate is string => typeof candidate === 'string' && Boolean(candidate))
  const backups = stringArray(item.backupUrl ?? item.backup_url)
  if (!primary) return backups.length > 0 ? selectBilibiliCdnUrl(backups[0], backups.slice(1)) : undefined
  return selectBilibiliCdnUrl(primary, backups)
}

/** playurl 响应里普通视频走 `data`, 番剧走 `result`, 两者结构一致。 */
const playUrlRoot = (payload: unknown) => {
  const root = asObject(payload)
  return asObject(root?.data) ?? asObject(root?.result)
}

const selectBilibiliDurl = (payload: unknown) => {
  const data = playUrlRoot(payload)
  const durl = Array.isArray(data?.durl) ? data.durl : []
  return streamUrlOf(durl[0])
}

export const selectBestBilibiliStream = (streams: unknown[], codecPreference: BilibiliCodecPreference = 'auto', maxQuality?: number) => {
  const preference = normalizeCodecPreference(codecPreference)
  const candidates = streams
    .map(stream => {
      const item = asObject(stream)
      return {
        id: Number(item?.id ?? item?.quality ?? 0),
        bandwidth: Number(item?.bandwidth ?? 0),
        codecs: String(item?.codecs || ''),
        url: streamUrlOf(item)
      }
    })
    .filter((item): item is { id: number, bandwidth: number, codecs: string, url: string } => Boolean(item.url))
  const quality = Number(maxQuality)
  const qualityCandidates = Number.isFinite(quality) && quality > 0
    ? candidates.filter(item => item.id <= quality)
    : candidates
  const selectable = qualityCandidates.length > 0 ? qualityCandidates : candidates

  return selectable
    .sort((left, right) =>
      codecPreferenceRank(left.codecs, preference) - codecPreferenceRank(right.codecs, preference)
      || right.id - left.id
      || left.bandwidth - right.bandwidth
    )[0]
}

const selectBilibiliDash = (payload: unknown, codecPreference: BilibiliCodecPreference, maxQuality?: number) => {
  const data = playUrlRoot(payload)
  const dash = asObject(data?.dash)
  const videos = Array.isArray(dash?.video) ? dash.video : []
  const audios = Array.isArray(dash?.audio) ? dash.audio : []
  const video = selectBestBilibiliStream(videos, codecPreference, maxQuality)
  const audio = selectBestBilibiliStream(audios, 'auto')
  return video ? { videoUrl: video.url, audioUrl: audio?.url } : undefined
}

/**
 * fnval 是二进制标志位: 16=DASH, 2048=AV1, 1024=8K, 128=4K, 64=HDR, 512=杜比视界。
 * 只请求 16 时 AV1 流根本不会出现在候选里, `codec: 'av1'` 因此永远选不中。
 */
export const calculateBilibiliFnval = (quality: number | string) => {
  const qn = Math.trunc(normalizeNumber(quality, 112))
  let fnval = 16 | 2048
  let fourk = 0
  if (qn === 127) {
    fnval |= 1024
    fourk = 1
  } else if (qn === 126) {
    fnval |= 512
    fourk = 1
  } else if (qn === 125) {
    fnval |= 64
    fourk = 1
  } else if (qn === 120) {
    fnval |= 128
    fourk = 1
  }
  return { fnval, fourk }
}

export const createBilibiliPlayUrl = (bvid: string, cid: number | string, quality: number | string = 112) => {
  const { fnval, fourk } = calculateBilibiliFnval(quality)
  const url = new URL(BILIBILI_PLAY_URL)
  url.searchParams.set('bvid', bvid)
  url.searchParams.set('cid', String(cid))
  url.searchParams.set('qn', String(Math.trunc(normalizeNumber(quality, 112))))
  url.searchParams.set('fnval', String(fnval))
  url.searchParams.set('fnver', '0')
  url.searchParams.set('fourk', String(fourk))
  return url.toString()
}

const createBilibiliBangumiPlayUrl = (epId: string, cid: number | string, quality: number | string = 112) => {
  const { fnval, fourk } = calculateBilibiliFnval(quality)
  const url = new URL(BILIBILI_BANGUMI_PLAY_URL)
  url.searchParams.set('ep_id', epId)
  url.searchParams.set('cid', String(cid))
  url.searchParams.set('qn', String(Math.trunc(normalizeNumber(quality, 112))))
  url.searchParams.set('fnval', String(fnval))
  url.searchParams.set('fnver', '0')
  url.searchParams.set('fourk', String(fourk))
  return url.toString()
}

/** 充电专属/付费内容只下发试看片段, is_preview=1 时不能当完整视频发。 */
const isPreviewOnlyPayload = (payload: unknown) => {
  const data = playUrlRoot(payload)
  return Number(data?.is_preview ?? 0) === 1 || Number(data?.preview ?? 0) === 1
}

const permissionDeniedMessage = '该内容为大会员/充电专属，当前 Cookie 没有播放权限，仅返回视频信息。'

const previewOnlyMessage = '当前账号仅能获取试看片段（UP主充电专属/付费内容），已按试看发送。'

/** 试看/付费内容在 playurl 里会以 is_preview=1 或 -10403 表现出来, 不能当完整视频发。 */
const inaccessibleMessage = (payload: unknown) => {
  const code = Number(asObject(payload)?.code)
  return code === -10403 || code === -403 ? permissionDeniedMessage : mediaFallbackMessage
}

const fetchOnlineTotal = async (bvid: string, cid: string | number, headers: Record<string, string>) => {
  try {
    const payload = await fetchResolverJson(`${BILIBILI_ONLINE}?bvid=${encodeURIComponent(bvid)}&cid=${encodeURIComponent(String(cid))}`, { headers })
    const data = asObject(asObject(payload)?.data)
    const total = Number(data?.total)
    const count = Number(data?.count)
    if (!Number.isFinite(total)) return undefined
    return `当前视频有 ${total} 人在观看，其中 ${Number.isFinite(count) ? count : 0} 人在网页端观看`
  } catch {
    return undefined
  }
}

const fallbackFromMediaFailure = (result: ResolvedPost, reason: unknown, url: string): ResolvedPost => {
  logResolverStage({
    platform: 'bilibili',
    stage: 'media',
    ok: false,
    reason: reason instanceof Error ? reason.message : String(reason),
    url,
    extra: { fallback: 'cover-link-only' }
  })
  logResolverStage({
    platform: 'bilibili',
    stage: 'fallback',
    ok: true,
    url: result.pageUrl,
    extra: { source: 'cover-link-only' }
  })
  return appendDescription(result, mediaFallbackMessage)
}

export const normalizeBilibiliVideoInfo = (pageUrl: string, payload: unknown): ResolvedPost | ResolverFailure => {
  const root = asObject(payload)
  const data = asObject(root?.data)
  if (Number(root?.code) !== 0 || !data) return failure(String(root?.message || 'B站接口返回异常'))

  const stat = asObject(data.stat)
  const desc = String(data.desc || '').trim()
  const coverUrl = typeof data.pic === 'string' && data.pic.trim() ? data.pic.trim() : undefined
  const owner = asObject(data.owner)
  const authorAvatar = typeof owner?.face === 'string' && owner.face.trim() ? owner.face.trim() : undefined
  const tag = typeof data.tname === 'string' && data.tname.trim() ? data.tname.trim() : undefined
  const contentBlocks: RichContentBlock[] = [
    desc ? { type: 'text', text: desc } : undefined,
    coverUrl ? { type: 'image', url: coverUrl } : undefined
  ].filter((item): item is RichContentBlock => Boolean(item))
  const description = [desc, formatStats(stat)]
    .map(item => String(item || '').trim())
    .filter(Boolean)
    .join('\n')

  const bvid = String(data.bvid || extractBvid(pageUrl) || '')
  const aid = Number(data.aid) > 0 ? String(data.aid) : extractBilibiliAid(pageUrl)
  const canonicalUrl = bvid
    ? `https://www.bilibili.com/video/${bvid}`
    : aid
      ? `https://www.bilibili.com/video/av${aid}`
      : pageUrl

  return {
    platform: 'bilibili',
    displayName: '哔哩哔哩',
    title: String(data.title || 'B站视频'),
    description,
    author: typeof owner?.name === 'string' ? owner.name : undefined,
    pageUrl: canonicalUrl,
    videos: [],
    images: coverUrl ? [coverUrl] : [],
    extras: {
      coverUrl,
      authorAvatar,
      tags: tag ? [tag] : [],
      contentBlocks,
      ...(data.pubdate ? { createdAt: data.pubdate } : {})
    }
  }
}

const expandShortUrl = async (url: string) => {
  if (!isBilibiliShortUrl(url)) return url

  try {
    return await resolveResolverRedirectUrl(url)
  } catch {
    // 跟跳失败（如短链服务拦截 HEAD）时回退到原始短链，让后续识别尽力而为。
    return url
  }
}

const resolveBilibiliVideo = async (target: Extract<BilibiliTarget, { kind: 'video' }>, url: string, cookie: string): Promise<ResolverResult> => {
  const headers: Record<string, string> = {
    'User-Agent': bilibiliUserAgent,
    Referer: 'https://www.bilibili.com/'
  }
  if (cookie) headers.Cookie = cookie

  const viewUrl = target.bvid
    ? `${BILIBILI_VIDEO_INFO}?bvid=${encodeURIComponent(target.bvid)}`
    : `${BILIBILI_VIDEO_INFO}?aid=${encodeURIComponent(String(target.aid))}`
  const payload = await fetchResolverJson(viewUrl, { headers })
  const result = normalizeBilibiliVideoInfo(url, payload)
  if ('ok' in result) return result

  const data = asObject(asObject(payload)?.data)
  const bvid = String(data?.bvid || target.bvid || '')
  if (!bvid) return result

  const requestedPage = target.page
  const pages = Array.isArray(data?.pages) ? data.pages : []
  const pageEntry = asObject(pages[requestedPage - 1])
  const cid = pageEntry?.cid ?? data?.cid
  const duration = Number(pageEntry?.duration ?? data?.duration ?? 0)
  const resolverConfig = Config.resolver
  const bilibiliConfig = resolverConfig.bilibili
  const maxDuration = normalizeNumber(bilibiliConfig?.maxVideoDurationSeconds ?? resolverConfig.maxVideoDurationSeconds, 480)
  if (maxDuration > 0 && duration > maxDuration) {
    return {
      ...result,
      description: [
        result.description,
        `视频时长 ${duration} 秒，超过当前下载上限 ${maxDuration} 秒，仅返回视频信息。`
      ].filter(Boolean).join('\n')
    }
  }
  if (!cid) return result

  const basePageUrl = result.pageUrl || url
  const pageUrl = requestedPage > 1 && !/[?&]p=\d+/.test(basePageUrl)
    ? `${basePageUrl}${basePageUrl.includes('?') ? '&' : '?'}p=${requestedPage}`
    : basePageUrl
  const mediaHeaders = {
    ...headers,
    Referer: pageUrl
  }
  const quality = normalizeNumber(bilibiliConfig?.quality, 112)
  const codec = normalizeCodecPreference(bilibiliConfig?.codec)
  const playUrl = createBilibiliPlayUrl(bvid, String(cid), quality)

  let playPayload: unknown
  try {
    playPayload = await fetchResolverJson(playUrl, { headers: mediaHeaders })
  } catch (error) {
    return fallbackFromMediaFailure(result, error, playUrl)
  }

  const dash = selectBilibiliDash(playPayload, codec, quality)
  const progressiveUrl = dash ? undefined : selectBilibiliDurl(playPayload)
  if (!dash && !progressiveUrl) {
    logResolverStage({
      platform: 'bilibili',
      stage: 'media',
      ok: false,
      reason: String(asObject(playPayload)?.message || 'no playable stream'),
      url: playUrl
    })
    return appendDescription(result, inaccessibleMessage(playPayload))
  }

  const videos: ResolverVideo[] = dash
    ? [{ url: dash.videoUrl, ...(dash.audioUrl ? { audioUrl: dash.audioUrl } : {}) }]
    : [{ url: progressiveUrl as string }]

  const online = await fetchOnlineTotal(bvid, cid, mediaHeaders)
  let resolved: ResolvedPost = {
    ...result,
    videos,
    description: [result.description, online].filter(Boolean).join('\n')
  }
  if (isPreviewOnlyPayload(playPayload)) resolved = appendDescription(resolved, previewOnlyMessage)
  return resolved
}

type BangumiSeasonInfo = {
  season: Record<string, any>
  episode: Record<string, any> | undefined
  episodes: Record<string, any>[]
}

const loadBangumiEpisode = async (epId: string, headers: Record<string, string>): Promise<BangumiSeasonInfo | undefined> => {
  const payload = await fetchResolverJson(`${BILIBILI_EP_INFO}?ep_id=${encodeURIComponent(epId)}`, { headers })
  const root = asObject(payload)
  if (Number(root?.code) !== 0) return undefined
  const season = asObject(root?.result)
  if (!season) return undefined
  const episodes = (Array.isArray(season.episodes) ? season.episodes : [])
    .map(item => asObject(item))
    .filter((item): item is Record<string, any> => Boolean(item))
  const episode = episodes.find(item => String(item.ep_id) === String(epId)) || episodes[0]
  return { season, episode, episodes }
}

const resolveBilibiliBangumi = async (
  target: Extract<BilibiliTarget, { kind: 'bangumi' }>,
  url: string,
  cookie: string
): Promise<ResolverResult> => {
  const headers: Record<string, string> = {
    'User-Agent': bilibiliUserAgent,
    Referer: 'https://www.bilibili.com/'
  }
  if (cookie) headers.Cookie = cookie

  let epId = target.epId
  if (!epId && target.seasonId) {
    try {
      const sectionPayload = await fetchResolverJson(`${BILIBILI_SEASON_SECTION}?season_id=${encodeURIComponent(target.seasonId)}`, { headers })
      const mainSection = asObject(asObject(asObject(sectionPayload)?.result)?.main_section)
      const firstEpisode = asObject(Array.isArray(mainSection?.episodes) ? mainSection?.episodes[0] : undefined)
      epId = firstEpisode?.ep_id ? String(firstEpisode.ep_id) : undefined
    } catch (error) {
      return failure(`番剧信息获取失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }
  if (!epId) return failure('无法识别番剧 EP 号')

  let loaded: BangumiSeasonInfo | undefined
  try {
    loaded = await loadBangumiEpisode(epId, headers)
  } catch (error) {
    return failure(`番剧信息获取失败：${error instanceof Error ? error.message : String(error)}`)
  }
  if (!loaded) return failure('番剧接口未返回剧集信息')

  const { season, episode } = loaded
  const coverUrl = typeof season.cover === 'string' && season.cover.trim() ? season.cover.trim() : undefined
  const typeName = String(season.type_name || '番剧')
  const seasonTitle = String(season.title || 'B站番剧')
  const episodeTitle = [episode?.title, episode?.long_title].filter(Boolean).join(' ')
  const rating = asObject(season.rating)
  const seasonStat = asObject(season.stat)
  const description = [
    episodeTitle ? `🎬 剧集：${episodeTitle}` : '',
    rating?.score ? `🎯 评分：${rating.score} / ${rating.count ?? '-'}` : '',
    asObject(season.new_ep)?.desc ? `📺 ${asObject(season.new_ep)?.desc}` : '',
    formatStats({
      view: seasonStat?.views,
      danmaku: seasonStat?.danmakus,
      like: seasonStat?.likes,
      coin: seasonStat?.coins,
      favorite: seasonStat?.favorites ?? seasonStat?.favorite
    })
  ].filter(Boolean).join('\n')

  const contentBlocks: RichContentBlock[] = [
    episodeTitle ? { type: 'text', text: episodeTitle } : undefined,
    coverUrl ? { type: 'image', url: coverUrl } : undefined
  ].filter((item): item is RichContentBlock => Boolean(item))

  const base: ResolvedPost = {
    platform: 'bilibili',
    displayName: `哔哩哔哩${typeName}`,
    title: episodeTitle ? `${seasonTitle} ｜ ${episodeTitle}` : seasonTitle,
    description,
    pageUrl: url,
    videos: [],
    images: coverUrl ? [coverUrl] : [],
    extras: {
      coverUrl,
      tags: typeName ? [typeName] : [],
      contentBlocks
    }
  }

  const bilibiliConfig = Config.resolver.bilibili
  const maxDuration = normalizeNumber(bilibiliConfig?.maxVideoDurationSeconds ?? Config.resolver.maxVideoDurationSeconds, 480)
  // 番剧接口的 duration 是毫秒
  const durationSeconds = Number(episode?.duration) > 0 ? Math.trunc(Number(episode?.duration) / 1000) : 0
  if (maxDuration > 0 && durationSeconds > maxDuration) {
    return appendDescription(base, `剧集时长 ${durationSeconds} 秒，超过当前下载上限 ${maxDuration} 秒，仅返回番剧信息。`)
  }

  const cid = episode?.cid
  if (!cid) return base

  const quality = normalizeNumber(bilibiliConfig?.quality, 112)
  const codec = normalizeCodecPreference(bilibiliConfig?.codec)
  const playUrl = createBilibiliBangumiPlayUrl(epId, String(cid), quality)
  let playPayload: unknown
  try {
    playPayload = await fetchResolverJson(playUrl, { headers })
  } catch (error) {
    return fallbackFromMediaFailure(base, error, playUrl)
  }

  const dash = selectBilibiliDash(playPayload, codec, quality)
  const progressiveUrl = dash ? undefined : selectBilibiliDurl(playPayload)
  if (!dash && !progressiveUrl) {
    logResolverStage({
      platform: 'bilibili',
      stage: 'media',
      ok: false,
      reason: String(asObject(playPayload)?.message || 'no playable bangumi stream'),
      url: playUrl
    })
    return appendDescription(base, inaccessibleMessage(playPayload))
  }

  const resolved: ResolvedPost = {
    ...base,
    videos: dash
      ? [{ url: dash.videoUrl, ...(dash.audioUrl ? { audioUrl: dash.audioUrl } : {}) }]
      : [{ url: progressiveUrl as string }]
  }
  return isPreviewOnlyPayload(playPayload) ? appendDescription(resolved, previewOnlyMessage) : resolved
}

const resolveBilibiliLive = async (roomId: string): Promise<ResolverResult> => {
  const payload = await fetchResolverJson(`${BILIBILI_LIVE_INFO}?room_id=${encodeURIComponent(roomId)}`, {
    headers: {
      'User-Agent': bilibiliUserAgent,
      Referer: `https://live.bilibili.com/${roomId}`
    }
  })
  const root = asObject(payload)
  const data = asObject(root?.data)
  if (Number(root?.code) !== 0 || !data) return failure(String(root?.message || '直播间信息获取失败'))

  const coverUrl = [data.user_cover, data.keyframe]
    .filter((item): item is string => typeof item === 'string' && Boolean(item.trim()))
  const online = Number(data.online)
  const areaName = [data.parent_area_name, data.area_name].filter(Boolean).join('-')
  const description = [
    typeof data.description === 'string' && data.description.trim() ? `📝 简述：${data.description.trim()}` : '',
    typeof data.tags === 'string' && data.tags.trim() ? `🔖 标签：${data.tags.trim()}` : '',
    areaName ? `📍 分区：${areaName}` : '',
    typeof data.live_time === 'string' && data.live_time.trim() ? `⏰ 直播时间：${data.live_time.trim()}` : '',
    Number.isFinite(online) ? `🏄 在线人数：${online}` : '',
    `📺 播放页：https://www.bilibili.com/blackboard/live/live-activity-player.html?enterTheRoom=0&cid=${roomId}`
  ].filter(Boolean).join('\n')

  return {
    platform: 'bilibili',
    displayName: '哔哩哔哩直播',
    title: String(data.title || 'B站直播间'),
    description,
    pageUrl: `https://live.bilibili.com/${roomId}`,
    videos: [],
    images: coverUrl,
    extras: {
      coverUrl: coverUrl[0],
      contentBlocks: [
        { type: 'text', text: String(data.title || 'B站直播间') },
        ...coverUrl.map(url => ({ type: 'image' as const, url }))
      ]
    }
  }
}

const decodeHtmlEntities = (text: string) => text
  .replace(/&nbsp;/gi, ' ')
  .replace(/&lt;/gi, '<')
  .replace(/&gt;/gi, '>')
  .replace(/&quot;/gi, '"')
  .replace(/&#39;/gi, "'")
  .replace(/&amp;/gi, '&')

const textFromNodes = (nodes: unknown): string => {
  if (!Array.isArray(nodes)) return ''
  let text = ''
  for (const node of nodes) {
    const item = asObject(node)
    if (!item) continue
    const word = asObject(item.word)
    if (typeof word?.words === 'string') text += word.words
    const rich = asObject(item.rich)
    if (rich) {
      if (typeof rich.text === 'string' && rich.text) text += rich.text
      else if (typeof rich.name === 'string' && rich.name) text += `@${rich.name}`
    }
  }
  return decodeHtmlEntities(text)
}

const resolveBilibiliDynamic = async (dynamicId: string, cookie: string): Promise<ResolverResult> => {
  const cookieHeader = bilibiliCookieHeader(cookie)
  if (!cookieHeader) return failure('解析 B站动态需要配置 B站 Cookie（SESSDATA）')

  const url = new URL(BILIBILI_OPUS_DETAIL)
  url.searchParams.set('id', dynamicId)
  url.searchParams.set('features', 'onlyfansVote,onlyfansAssetsV2,decorationCard,htmlNewStyle,ugcDelete,editable,opusPrivateVisible,tribeeEdit,avatarAutoTheme,avatarTypeOpus')

  let payload: unknown
  try {
    payload = await fetchResolverJson(url.toString(), {
      headers: {
        'User-Agent': bilibiliUserAgent,
        Referer: `https://t.bilibili.com/${dynamicId}`,
        Cookie: cookieHeader
      }
    })
  } catch (error) {
    return failure(`动态接口请求失败：${error instanceof Error ? error.message : String(error)}`)
  }

  const root = asObject(payload)
  const item = asObject(asObject(root?.data)?.item)
  if (Number(root?.code) !== 0 || !item) return failure(String(root?.message || '动态接口返回异常'))

  const blocks: RichContentBlock[] = []
  const images: string[] = []
  let title = ''
  for (const rawModule of Array.isArray(item.modules) ? item.modules : []) {
    const module = asObject(rawModule)
    if (!module) continue
    const moduleType = String(module.module_type || '')

    if (moduleType === 'MODULE_TYPE_TITLE') {
      const moduleTitle = asObject(module.module_title)
      if (typeof moduleTitle?.text === 'string') title = decodeHtmlEntities(moduleTitle.text)
      continue
    }
    if (moduleType === 'MODULE_TYPE_TOPIC') {
      const topic = asObject(module.module_topic)
      if (typeof topic?.name === 'string') blocks.push({ type: 'text', text: `🏷️ 话题：${decodeHtmlEntities(topic.name)}` })
      continue
    }
    if (moduleType === 'MODULE_TYPE_TOP') {
      const display = asObject(asObject(module.module_top)?.display)
      for (const pic of Array.isArray(asObject(display?.album)?.pics) ? asObject(display?.album)?.pics : []) {
        const picUrl = asObject(pic)?.url
        if (typeof picUrl === 'string' && picUrl) {
          images.push(picUrl)
          blocks.push({ type: 'image', url: picUrl })
        }
      }
      continue
    }
    if (moduleType !== 'MODULE_TYPE_CONTENT') continue

    const paragraphs = Array.isArray(asObject(module.module_content)?.paragraphs) ? asObject(module.module_content)?.paragraphs : []
    for (const rawParagraph of paragraphs) {
      const paragraph = asObject(rawParagraph)
      if (!paragraph) continue
      const paraType = Number(paragraph.para_type)
      if (paraType === 1 || paraType === 4) {
        const text = textFromNodes(asObject(paragraph.text)?.nodes)
        if (text.trim()) blocks.push({ type: 'text', text: paraType === 4 ? `「${text}」` : text })
      } else if (paraType === 2) {
        const pics = Array.isArray(asObject(paragraph.pic)?.pics) ? asObject(paragraph.pic)?.pics : []
        for (const pic of pics) {
          const picUrl = asObject(pic)?.url
          if (typeof picUrl === 'string' && picUrl) {
            images.push(picUrl)
            blocks.push({ type: 'image', url: picUrl })
          }
        }
      } else if (paraType === 3) {
        blocks.push({ type: 'text', text: '---' })
      } else if (paraType === 5) {
        const items = Array.isArray(asObject(paragraph.list)?.items) ? asObject(paragraph.list)?.items : []
        for (const listItem of items) {
          const text = textFromNodes(asObject(listItem)?.nodes)
          if (text.trim()) blocks.push({ type: 'text', text: `• ${text}` })
        }
      }
    }
  }

  if (blocks.length === 0 && images.length === 0) return failure('动态内容为空')

  const authorModule = (Array.isArray(item.modules) ? item.modules : [])
    .map(rawModule => asObject(rawModule))
    .find(module => module?.module_type === 'MODULE_TYPE_AUTHOR')
  const author = asObject(authorModule?.module_author)
  const textBlocks = blocks.filter((block): block is { type: 'text', text: string } => block.type === 'text')
  return {
    platform: 'bilibili',
    displayName: '哔哩哔哩动态',
    title: title || '哔哩哔哩动态',
    description: textBlocks.map(block => block.text).join('\n'),
    author: typeof author?.name === 'string' ? author.name : undefined,
    pageUrl: `https://t.bilibili.com/${dynamicId}`,
    videos: [],
    images,
    extras: {
      coverUrl: images[0],
      contentBlocks: blocks
    }
  }
}

const resolveBilibiliArticle = async (cvid: string, cookie: string): Promise<ResolverResult> => {
  const headers: Record<string, string> = {
    'User-Agent': bilibiliUserAgent,
    Referer: 'https://www.bilibili.com/'
  }
  if (cookie) headers.Cookie = cookie

  let payload: unknown
  try {
    payload = await fetchResolverJson(`${BILIBILI_ARTICLE_INFO}?id=${encodeURIComponent(cvid)}`, { headers })
  } catch (error) {
    return failure(`专栏接口请求失败：${error instanceof Error ? error.message : String(error)}`)
  }
  const root = asObject(payload)
  const data = asObject(root?.data)
  if (Number(root?.code) !== 0 || !data) return failure(String(root?.message || '专栏接口返回异常'))

  const images = stringArray(data.origin_image_urls)
  const coverUrl = typeof data.banner_url === 'string' && data.banner_url.trim() ? data.banner_url.trim() : undefined
  const title = String(data.title || 'B站专栏')
  const description = [
    formatStats({
      view: asObject(data.stats)?.view,
      favorite: asObject(data.stats)?.favorite,
      like: asObject(data.stats)?.like,
      reply: asObject(data.stats)?.reply
    })
  ].filter(Boolean).join('\n')

  return {
    platform: 'bilibili',
    displayName: '哔哩哔哩专栏',
    title,
    description,
    author: typeof data.author_name === 'string' ? data.author_name : undefined,
    pageUrl: `https://www.bilibili.com/read/cv${cvid}`,
    videos: [],
    images: images.length > 0 ? images : coverUrl ? [coverUrl] : [],
    extras: {
      coverUrl: coverUrl || images[0],
      contentBlocks: [
        { type: 'text', text: title },
        ...(images.length > 0 ? images : coverUrl ? [coverUrl] : []).map(url => ({ type: 'image' as const, url }))
      ]
    }
  }
}

export const resolveBilibili = async (url: string, cookie = ''): Promise<ResolverResult> => {
  let finalUrl = url
  try {
    finalUrl = await expandShortUrl(url)
  } catch {
    finalUrl = url
  }

  const target = classifyBilibiliUrl(finalUrl)
  if (!target) {
    // 短链跟跳失败时保留原始短链, 这里再试一次裸 BV 兜底
    const bvid = extractBvid(finalUrl)
    if (!bvid) return failure('无法识别 BVID')
    return resolveBilibiliVideo({ kind: 'video', bvid, page: extractBilibiliPage(finalUrl) }, finalUrl, cookie)
  }

  if (target.kind === 'live') return resolveBilibiliLive(target.roomId)
  if (target.kind === 'article') return resolveBilibiliArticle(target.cvid, cookie)
  if (target.kind === 'dynamic') return resolveBilibiliDynamic(target.dynamicId, cookie)
  if (target.kind === 'bangumi') return resolveBilibiliBangumi(target, finalUrl, cookie)
  return resolveBilibiliVideo(target, finalUrl, cookie)
}
