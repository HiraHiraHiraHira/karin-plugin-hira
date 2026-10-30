import { Config } from '@/config'
import { fetchResolverJson, fetchResolverText, resolveResolverRedirectUrl } from '@/services/resolverHttp'
import type { ResolverConfig } from '@/types/config'

import { isLikelyVideoUrl, resolveByGeneralApis } from './general'
import { logResolverStage } from './resolverLog'
import type { ResolvedPost, ResolverFailure, ResolverResult, ResolverVideo } from './types'

const failure = (reason: string): ResolverFailure => ({
  platform: 'douyin',
  displayName: '抖音',
  ok: false,
  reason
})

const asObject = (value: unknown): Record<string, any> | undefined => {
  return typeof value === 'object' && value !== null ? value as Record<string, any> : undefined
}

const firstUrl = (value: unknown) => {
  if (typeof value === 'string' && value.trim()) return value
  if (!Array.isArray(value)) return undefined
  return value.find((item): item is string => typeof item === 'string' && item.trim().length > 0)
}

const firstVideoUrl = (value: unknown) => {
  if (typeof value === 'string' && value.trim() && isLikelyVideoUrl(value)) return value
  if (!Array.isArray(value)) return undefined
  return value.find((item): item is string => typeof item === 'string' && item.trim().length > 0 && isLikelyVideoUrl(item))
}

const pushUnique = (items: string[], value: unknown) => {
  const url = firstUrl(value)
  if (url && !items.includes(url)) items.push(url)
}

const pushVideo = (items: ResolverVideo[], url: string | undefined, audioUrl?: string) => {
  if (!url) return
  const existing = items.find(item => item.url === url)
  if (!existing) {
    items.push({ url, ...(audioUrl ? { audioUrl } : {}) })
    return
  }
  if (audioUrl && !existing.audioUrl) existing.audioUrl = audioUrl
}

type DouyinQuality = ResolverConfig['douyin']['quality']

type DouyinNormalizeOptions = {
  quality?: DouyinQuality
  maxVideoDurationSeconds?: number | string
}

const validDouyinQualities = new Set<DouyinQuality>(['adapt', '540p', '720p', '1080p', '2k', '4k'])
const douyinQualityPriority = ['4k', '2k', '1080p', '720p', '540p'] as const
type FixedDouyinQuality = typeof douyinQualityPriority[number]

const isFixedDouyinQuality = (value: string): value is FixedDouyinQuality => {
  return douyinQualityPriority.includes(value as FixedDouyinQuality)
}

const normalizeQuality = (value: unknown): DouyinQuality => {
  const quality = String(value || '1080p').toLowerCase()
  return validDouyinQualities.has(quality as DouyinQuality) ? quality as DouyinQuality : '1080p'
}

const normalizeNumber = (value: unknown, fallback: number) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

const normalizeBytes = (value: unknown) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
}

/**
 * 抖音 `video.duration` 一般是毫秒, 但动图/部分接口会给秒。
 * 小于 1000 的值按秒处理, 避免 <1s 片段被当成上千秒的长视频而误判超限。
 */
const douyinDurationSeconds = (value: unknown) => {
  const raw = normalizeNumber(value, 0)
  if (raw <= 0) return 0
  return raw < 1000 ? Math.round(raw) : Math.trunc(raw / 1000)
}

const douyinQualityFromGear = (gearName: unknown): FixedDouyinQuality => {
  const gear = String(gearName || '').toLowerCase()
  if (gear.includes('lowest_4') || gear.includes('2160') || gear.includes('4k')) return '4k'
  if (gear.includes('1440') || gear.includes('2k')) return '2k'
  if (gear.includes('1080')) return '1080p'
  if (gear.includes('720')) return '720p'
  if (gear.includes('540')) return '540p'
  return '540p'
}

const createDouyinPlayUrl = (uri: unknown, quality: DouyinQuality) => {
  if (typeof uri !== 'string' || !uri.trim()) return undefined
  const ratio = quality === 'adapt' ? '1080p' : quality
  const url = new URL('https://aweme.snssdk.com/aweme/v1/play/')
  url.searchParams.set('video_id', uri)
  url.searchParams.set('ratio', ratio)
  url.searchParams.set('line', '0')
  return url.toString()
}

const firstPlayAddrVideoUrl = (value: unknown, quality: DouyinQuality) => {
  const playAddr = asObject(value)
  return firstVideoUrl(playAddr?.url_list) || createDouyinPlayUrl(playAddr?.uri, quality)
}

const selectDouyinBitRateUrl = (bitRates: unknown, quality: DouyinQuality) => {
  if (!Array.isArray(bitRates)) return undefined

  const mp4Videos = bitRates
    .map(item => asObject(item))
    .filter((item): item is Record<string, any> => Boolean(item))
    .filter(item => String(item.format || '').toLowerCase() !== 'dash')

  if (mp4Videos.length === 0) return undefined

  const videosByQuality = new Map<FixedDouyinQuality, Record<string, any>[]>()
  for (const item of mp4Videos) {
    const level = douyinQualityFromGear(item.gear_name)
    const group = videosByQuality.get(level) || []
    group.push(item)
    videosByQuality.set(level, group)
  }

  for (const group of videosByQuality.values()) {
    group.sort((a, b) => normalizeBytes(b.play_addr?.data_size) - normalizeBytes(a.play_addr?.data_size))
  }

  if (quality === 'adapt') {
    const sizeLimitBytes = 100 * 1024 * 1024
    for (const level of douyinQualityPriority) {
      const item = videosByQuality.get(level)?.find(video => {
        const size = normalizeBytes(video.play_addr?.data_size)
        return size === 0 || size <= sizeLimitBytes
      })
      const url = firstPlayAddrVideoUrl(item?.play_addr, quality)
      if (url) return url
    }

    const smallest = mp4Videos.reduce((current, item) => {
      const currentSize = normalizeBytes(current.play_addr?.data_size)
      const itemSize = normalizeBytes(item.play_addr?.data_size)
      if (currentSize === 0) return item
      if (itemSize === 0) return current
      return itemSize < currentSize ? item : current
    }, mp4Videos[0])
    return firstPlayAddrVideoUrl(smallest.play_addr, quality)
  }

  const targetIndex = douyinQualityPriority.indexOf(quality)
  const targetLevels = isFixedDouyinQuality(quality)
    ? [
        quality,
        ...douyinQualityPriority.slice(targetIndex + 1),
        ...douyinQualityPriority.slice(0, targetIndex).reverse()
      ]
    : douyinQualityPriority

  for (const level of targetLevels) {
    const url = firstPlayAddrVideoUrl(videosByQuality.get(level)?.[0]?.play_addr, quality)
    if (url) return url
  }

  return firstPlayAddrVideoUrl(mp4Videos[0].play_addr, quality)
}

const selectDouyinVideoUrl = (video: Record<string, any>, quality: DouyinQuality) => {
  return selectDouyinBitRateUrl(video.bit_rate, quality)
    || firstPlayAddrVideoUrl(video.play_addr, quality)
    || firstPlayAddrVideoUrl(video.play_addr_h264, quality)
    || firstPlayAddrVideoUrl(video.download_addr, quality)
}

const createDouyinDetailUrl = (awemeId: string) => {
  const url = new URL('https://www.douyin.com/aweme/v1/web/aweme/detail/')
  url.searchParams.set('device_platform', 'webapp')
  url.searchParams.set('aid', '6383')
  url.searchParams.set('channel', 'channel_pc_web')
  url.searchParams.set('aweme_id', awemeId)
  url.searchParams.set('pc_client_type', '1')
  url.searchParams.set('version_code', '190500')
  url.searchParams.set('version_name', '19.5.0')
  url.searchParams.set('cookie_enabled', 'true')
  url.searchParams.set('screen_width', '1344')
  url.searchParams.set('screen_height', '756')
  url.searchParams.set('browser_language', 'zh-CN')
  url.searchParams.set('browser_platform', 'Win32')
  url.searchParams.set('browser_name', 'Firefox')
  url.searchParams.set('browser_version', '118.0')
  url.searchParams.set('browser_online', 'true')
  url.searchParams.set('engine_name', 'Gecko')
  url.searchParams.set('engine_version', '109.0')
  url.searchParams.set('os_name', 'Windows')
  url.searchParams.set('os_version', '10')
  url.searchParams.set('cpu_core_num', '16')
  url.searchParams.set('platform', 'PC')
  return url.toString()
}

export const extractDouyinAwemeId = (url: string) => {
  try {
    const parsed = new URL(url)
    return parsed.searchParams.get('modal_id')
      || parsed.pathname.match(/\/(?:video|note)\/(\d+)/)?.[1]
      || parsed.pathname.match(/\/share\/(?:video|slides)\/(\d+)/)?.[1]
  } catch {
    return undefined
  }
}

export type DouyinTarget =
  | { kind: 'live', roomId: string, via: 'enter' | 'reflow' }
  | { kind: 'work', awemeId?: string }

/**
 * 直播间识别: `live.douyin.com/<web_rid>` 走网页 enter 接口,
 * `webcast.amemv.com` 的 reflow 链接走客户端接口;两者都不能当普通作品解析。
 */
export const classifyDouyinUrl = (url: string): DouyinTarget => {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return { kind: 'work' }
  }

  const hostname = parsed.hostname.toLowerCase()
  if (hostname === 'webcast.amemv.com') {
    const roomId = parsed.pathname.match(/\/webcast\/reflow\/(\d+)/)?.[1]
    if (roomId) return { kind: 'live', roomId, via: 'reflow' }
  }
  if (hostname === 'live.douyin.com' || hostname.endsWith('.live.douyin.com')) {
    const roomId = parsed.pathname.match(/^\/(\d+)/)?.[1]
    if (roomId) return { kind: 'live', roomId, via: 'enter' }
  }
  const liveRoomId = parsed.pathname.match(/\/live\/(\d+)/)?.[1]
  if (liveRoomId) return { kind: 'live', roomId: liveRoomId, via: 'enter' }

  return { kind: 'work', awemeId: extractDouyinAwemeId(url) }
}

/**
 * reflow 接口要求 `verifyFp` 设备指纹: 36 位随机串, 第 9/14/19/24 位是下划线, 第 15 位固定 4。
 * 与 R `utils/tiktok.js` 的 genVerifyFp 同构。
 */
const createDouyinVerifyFp = () => {
  const base = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'
  const slots = new Array<string>(36).fill('')
  for (const index of [8, 13, 18, 23]) slots[index] = '_'
  slots[14] = '4'
  for (let index = 0; index < 36; index += 1) {
    if (slots[index]) continue
    let pick = Math.floor(Math.random() * base.length)
    if (index === 19) pick = (3 & pick) | 8
    slots[index] = base[pick]
  }
  return `verify_${Date.now().toString(36)}_${slots.join('')}`
}

const createDouyinLiveUrl = (roomId: string, via: 'enter' | 'reflow', msToken = '') => {
  if (via === 'reflow') {
    const reflow = new URL('https://webcast.amemv.com/webcast/room/reflow/info/')
    reflow.searchParams.set('type_id', '0')
    reflow.searchParams.set('live_id', '1')
    reflow.searchParams.set('sec_user_id', '')
    reflow.searchParams.set('version_code', '99.99.99')
    reflow.searchParams.set('app_id', '1128')
    reflow.searchParams.set('room_id', roomId)
    reflow.searchParams.set('verifyFp', createDouyinVerifyFp())
    if (msToken) reflow.searchParams.set('msToken', msToken)
    return reflow.toString()
  }
  const url = new URL('https://live.douyin.com/webcast/room/web/enter/')
  url.searchParams.set('device_platform', 'webapp')
  url.searchParams.set('aid', '6383')
  url.searchParams.set('channel', 'channel_pc_web')
  url.searchParams.set('pc_client_type', '1')
  url.searchParams.set('version_code', '190500')
  url.searchParams.set('version_name', '19.5.0')
  url.searchParams.set('cookie_enabled', 'true')
  url.searchParams.set('screen_width', '1920')
  url.searchParams.set('screen_height', '1080')
  url.searchParams.set('browser_language', 'zh-CN')
  url.searchParams.set('browser_platform', 'Win32')
  url.searchParams.set('browser_name', 'Firefox')
  url.searchParams.set('browser_version', '124.0')
  url.searchParams.set('browser_online', 'true')
  url.searchParams.set('engine_name', 'Gecko')
  url.searchParams.set('engine_version', '122.0.0.0')
  url.searchParams.set('os_name', 'Windows')
  url.searchParams.set('os_version', '10')
  url.searchParams.set('cpu_core_num', '12')
  url.searchParams.set('device_memory', '8')
  url.searchParams.set('platform', 'PC')
  url.searchParams.set('web_rid', roomId)
  return url.toString()
}

/**
 * 在任意快照结构里找 `aweme_detail` 对象.
 * 真实页面形状不固定(`__NEXT_DATA__` 是 props.pageProps.aweme_detail,
 * universal 快照是 __DEFAULT_SCOPE__['webapp.video-detail'].aweme_detail),
 * 因此按键名深搜;只认这一个键,避免误命中别的同名结构以外的数据.
 * 深度上限 6 与数组前 40 项是硬边界:快照来自外部页面,恶意构造的超深/超宽 JSON
 * 会在递归里打爆调用栈或拖长解析,超出边界的快照直接放弃.
 */
const findAwemeDetail = (node: unknown, depth = 0): Record<string, unknown> | undefined => {
  if (depth > 6) return undefined
  if (Array.isArray(node)) {
    for (const item of node.slice(0, 40)) {
      const found = findAwemeDetail(item, depth + 1)
      if (found) return found
    }
    return undefined
  }
  const record = asObject(node)
  if (!record) return undefined
  const direct = asObject(record.aweme_detail)
  if (direct) return direct
  for (const value of Object.values(record)) {
    if (typeof value !== 'object' || value === null) continue
    const found = findAwemeDetail(value, depth + 1)
    if (found) return found
  }
  return undefined
}

/** 图集的 BGM: `music.play_url` 优先取直链, 只留 `uri` 时也登记, 由发送侧按需处理。 */
const douyinMusicUrl = (music: unknown) => {
  const playUrl = asObject(asObject(music)?.play_url)
  if (!playUrl) return undefined
  return firstUrl(playUrl.url_list) || (typeof playUrl.uri === 'string' && playUrl.uri.trim() ? playUrl.uri : undefined)
}

export const normalizeDouyinDetail = (
  pageUrl: string,
  payload: unknown,
  options: DouyinNormalizeOptions = {}
): ResolvedPost | ResolverFailure => {
  const root = asObject(payload)
  const detail = findAwemeDetail(root)
  if (!detail) return failure('抖音接口返回异常')

  const images: string[] = []
  const videos: ResolverVideo[] = []
  const quality = normalizeQuality(options.quality)
  const maxVideoDurationSeconds = normalizeNumber(options.maxVideoDurationSeconds, 0)
  let limitMessage = ''

  const imageItems = Array.isArray(detail.images) ? detail.images : []
  const video = asObject(detail.video)
  const author = asObject(detail.author)

  if (imageItems.length > 0) {
    // 图集/动图: 带 clip 的项只登记视频(与 R 的 processDouyinImageAlbum 一致, 视频取代静帧),
    // 没有 clip 的静帧才进 images —— images/videos 互不重叠, 发送侧无需去重或按顺序对齐。
    const isOriginalSound = detail.is_use_music === false
      || Number(asObject(detail.image_album_music_info)?.volume) === 0
    const bgmUrl = isOriginalSound ? undefined : douyinMusicUrl(detail.music)

    for (const rawImage of imageItems) {
      const image = asObject(rawImage)
      if (!image) continue
      const clipUrl = selectDouyinVideoUrl(asObject(image.video) || {}, quality)
      if (clipUrl) {
        pushVideo(videos, clipUrl, bgmUrl)
        continue
      }
      pushUnique(images, image.url_list)
    }
    pushUnique(images, asObject(video?.cover)?.url_list)
  } else if (video) {
    pushUnique(images, asObject(video.cover)?.url_list)
    pushUnique(images, asObject(video.origin_cover)?.url_list)

    const durationSeconds = douyinDurationSeconds(video.duration)
    const overDurationLimit = maxVideoDurationSeconds > 0 && durationSeconds > maxVideoDurationSeconds

    if (overDurationLimit) {
      limitMessage = `视频时长 ${durationSeconds} 秒，超过当前下载上限 ${maxVideoDurationSeconds} 秒，仅返回视频信息。`
    } else {
      pushVideo(videos, selectDouyinVideoUrl(video, quality))
    }
  }

  if (images.length === 0 && videos.length === 0) return failure('未找到抖音媒体资源')

  const desc = typeof detail.desc === 'string' ? detail.desc : ''
  const coverUrl = images[0]
  const authorAvatar = firstUrl(asObject(author?.avatar_thumb)?.url_list)

  return {
    platform: 'douyin',
    displayName: '抖音',
    title: desc || '抖音作品',
    description: [desc, limitMessage].filter(Boolean).join('\n'),
    author: author?.nickname,
    pageUrl,
    videos,
    images,
    extras: {
      coverUrl,
      ...(authorAvatar ? { authorAvatar } : {})
    }
  }
}

/**
 * 从 marker 之后第一个 `{` 起做括号深度扫描,返回配平的 JSON 对象串.
 * `aweme_detail` 里必然有嵌套对象(bit_rate/play_addr 等),固定长度或非贪婪正则
 * 都只能截到内层 `}`,因此必须按深度计数;字符串内的括号与转义引号不算结构.
 */
const extractBalancedJson = (text: string, marker: string): string | undefined => {
  const markerIndex = text.indexOf(marker)
  if (markerIndex < 0) return undefined
  const start = text.indexOf('{', markerIndex + marker.length)
  if (start < 0) return undefined

  let depth = 0
  let inString = false
  for (let index = start; index < text.length; index += 1) {
    const char = text[index]
    if (inString) {
      // 反斜杠转义下一个字符,避免把 \" 当成字符串结束
      if (char === '\\') index += 1
      else if (char === '"') inString = false
      continue
    }
    if (char === '"') inString = true
    else if (char === '{') depth += 1
    else if (char === '}') {
      depth -= 1
      if (depth === 0) return text.slice(start, index + 1)
    }
  }
  return undefined
}

/**
 * SSR 免 Cookie 兜底:无 Cookie 或官方接口失败时,抓分享页 HTML 内嵌的
 * `aweme_detail` / `__NEXT_DATA__` 快照,能解出媒体即返回,不抛错.
 * options 透传给 normalizeDouyinDetail,否则 SSR 路径会绕过时长上限与画质配置.
 */
export const normalizeDouyinSsrHtml = (
  pageUrl: string,
  html: string,
  options: DouyinNormalizeOptions = {}
): ResolvedPost | ResolverFailure => {
  if (!html || html.length < 200) return failure('抖音页面快照为空')
  const candidates: string[] = []
  // 惰性量词:贪婪 {200,} 会吞到文档最后一个 </script>,把后续 script 拼进 JSON 导致 parse 失败
  const nextData = html.match(/<script[^>]*id="__NEXT_DATA__"[^>]*>([\s\S]{200,}?)<\/script>/i)?.[1]
  if (nextData) candidates.push(nextData)
  const universal = html.match(/<script[^>]*>self\.__UNIVERSAL_DATA_FOR_REHYDRATION__\s*=\s*([\s\S]{500,}?)<\/script>/i)?.[1]
  if (universal) candidates.push(universal)
  // aweme_detail 直嵌片段兜底:用括号深度扫描代替正则,才能覆盖嵌套对象
  const awemeInline = extractBalancedJson(html, '"aweme_detail"')
  if (awemeInline) candidates.push(`{"aweme_detail":${awemeInline}}`)
  for (const raw of candidates) {
    try {
      const result = normalizeDouyinDetail(pageUrl, JSON.parse(raw), options)
      if (!('ok' in result)) return result
    } catch {
      // 换下一个快照候选
    }
  }
  return failure('抖音页面快照未找到可用媒体')
}

const expandShortUrl = async (url: string) => {
  if (!url.includes('v.douyin.com')) return url
  return resolveResolverRedirectUrl(url)
}

const resolveDouyinLive = async (
  target: Extract<DouyinTarget, { kind: 'live' }>,
  url: string,
  cookie: string,
  ssrHeaders: Record<string, string>
): Promise<ResolverResult> => {
  const headers = { ...ssrHeaders, ...(cookie ? { Cookie: cookie } : {}) }
  // reflow 需要 msToken; Cookie 里的 ttwid 是 R 插件同款的取用位置,缺失时不带该参数
  const msToken = cookie.match(/(?:^|;\s*)ttwid=([^;]+)/)?.[1] || ''
  let payload: unknown
  try {
    payload = await fetchResolverJson(createDouyinLiveUrl(target.roomId, target.via, msToken), { headers })
  } catch (error) {
    logResolverStage({
      platform: 'douyin',
      stage: 'api',
      ok: false,
      reason: error instanceof Error ? error.message : String(error),
      url
    })
    return failure('直播间信息获取失败，请检查链接或稍后重试')
  }

  const data = asObject(asObject(payload)?.data)
  const room = target.via === 'reflow'
    ? asObject(data?.room)
    : asObject(Array.isArray(data?.data) ? data?.data[0] : undefined)
  if (!room) {
    logResolverStage({ platform: 'douyin', stage: 'normalize', ok: false, reason: 'live room data missing', url })
    return failure('直播间信息为空，可能未开播或链接已失效')
  }

  const coverList = asObject(room.cover)?.url_list
  const coverUrl = Array.isArray(coverList)
    ? coverList.filter((item): item is string => typeof item === 'string' && Boolean(item.trim())).pop()
    : undefined
  const owner = asObject(room.owner)
  const onlineText = typeof room.user_count_str === 'string' && room.user_count_str.trim()
    ? room.user_count_str.trim()
    : Number.isFinite(Number(room.user_count)) && Number(room.user_count) > 0 ? String(Number(room.user_count)) : undefined
  const statusText = Number(room.status) === 2 ? '正在直播' : '未开播'
  const description = [
    typeof room.title === 'string' && room.title.trim() ? `📝 标题：${room.title.trim()}` : '',
    onlineText ? `🏄 在线人数：${onlineText}人正在观看` : '',
    `📺 状态：${statusText}`
  ].filter(Boolean).join('\n')

  return {
    platform: 'douyin',
    displayName: '抖音直播',
    title: String(room.title || '抖音直播间'),
    description,
    author: typeof owner?.nickname === 'string' ? owner.nickname : undefined,
    pageUrl: url,
    videos: [],
    images: coverUrl ? [coverUrl] : [],
    extras: { coverUrl }
  }
}

export const resolveDouyin = async (
  url: string,
  cookie: string,
  generalApis: string[]
): Promise<ResolverResult> => {
  let finalUrl = url
  try {
    finalUrl = await expandShortUrl(url)
  } catch {
    finalUrl = url
  }

  // detail 与 SSR 两条路径共用同一份归一化参数,避免 SSR 绕过时长上限与画质配置
  const normalizeOptions = {
    quality: normalizeQuality(Config.resolver.douyin?.quality),
    maxVideoDurationSeconds: Config.resolver.douyin?.maxVideoDurationSeconds ?? Config.resolver.maxVideoDurationSeconds
  }
  // SSR 页面与 detail 接口同源,复用同一套浏览器头(不含 Cookie,无 Cookie 时才走 SSR)
  const ssrHeaders = {
    'Accept-Language': 'zh-CN,zh;q=0.8,zh-TW;q=0.7,zh-HK;q=0.5,en-US;q=0.3,en;q=0.2',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:118.0) Gecko/20100101 Firefox/118.0',
    Referer: 'https://www.douyin.com/'
  }

  const target = classifyDouyinUrl(finalUrl)
  if (target.kind === 'live') return resolveDouyinLive(target, finalUrl, cookie, ssrHeaders)

  const awemeId = target.awemeId
  if (cookie && awemeId) {
    try {
      const headers = { ...ssrHeaders, Cookie: cookie }
      const requestUrl = createDouyinDetailUrl(awemeId)
      const result = normalizeDouyinDetail(finalUrl, await fetchResolverJson(requestUrl, { headers }), normalizeOptions)
      if (!('ok' in result)) {
        logResolverStage({
          platform: 'douyin',
          stage: 'api',
          ok: true,
          url: finalUrl,
          extra: { source: 'web-detail' }
        })
        return result
      }
      logResolverStage({
        platform: 'douyin',
        stage: 'normalize',
        ok: false,
        reason: result.reason,
        url: finalUrl
      })
    } catch (error) {
      logResolverStage({
        platform: 'douyin',
        stage: 'api',
        ok: false,
        reason: error instanceof Error ? error.message : String(error),
        url: finalUrl,
        extra: { fallback: 'general-api' }
      })
      // Fall back to configured general APIs.
    }
  }

  // SSR 免 Cookie 兜底:抓分享页 HTML 内嵌快照,能解出媒体直接返回
  try {
    const html = await fetchResolverText(finalUrl, { maxBytes: 3_000_000, headers: ssrHeaders })
    const ssr = normalizeDouyinSsrHtml(finalUrl, html, normalizeOptions)
    if (!('ok' in ssr)) {
      logResolverStage({ platform: 'douyin', stage: 'api', ok: true, url: finalUrl, extra: { source: 'ssr-html' } })
      return ssr
    }
    logResolverStage({ platform: 'douyin', stage: 'normalize', ok: false, reason: ssr.reason, url: finalUrl, extra: { fallback: 'general-api' } })
  } catch (error) {
    logResolverStage({
      platform: 'douyin',
      stage: 'api',
      ok: false,
      reason: error instanceof Error ? error.message : String(error),
      url: finalUrl,
      extra: { fallback: 'general-api' }
    })
  }

  logResolverStage({
    platform: 'douyin',
    stage: 'fallback',
    ok: true,
    url: finalUrl,
    extra: { source: 'general-api' }
  })
  return resolveByGeneralApis('抖音', finalUrl, generalApis)
}
