import { Config } from '@/config'
import { downloadFile } from '@/runtime/downloader'
import { runFfmpeg } from '@/runtime/ffmpeg'
import { createTempFilePath } from '@/runtime/temp'
import { fetchJson } from '@/services/http'
import type { ResolverConfig } from '@/types/config'

import { isLikelyVideoUrl, resolveByGeneralApis } from './general'
import type { ResolvedPost, ResolverFailure, ResolverResult } from './types'

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

const pushUniqueVideo = (items: string[], value: unknown) => {
  const url = firstVideoUrl(value)
  if (url && !items.includes(url)) items.push(url)
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

const douyinQualityFromGear = (gearName: unknown): FixedDouyinQuality => {
  const gear = String(gearName || '').toLowerCase()
  if (gear.includes('lowest_4') || gear.includes('2160') || gear.includes('4k')) return '4k'
  if (gear.includes('1440') || gear.includes('2k')) return '2k'
  if (gear.includes('1080')) return '1080p'
  if (gear.includes('720')) return '720p'
  if (gear.includes('540')) return '540p'
  return '540p'
}

const firstPlayAddrVideoUrl = (value: unknown) => {
  const playAddr = asObject(value)
  return firstVideoUrl(playAddr?.url_list)
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
      const url = firstPlayAddrVideoUrl(item?.play_addr)
      if (url) return url
    }

    const smallest = mp4Videos.reduce((current, item) => {
      const currentSize = normalizeBytes(current.play_addr?.data_size)
      const itemSize = normalizeBytes(item.play_addr?.data_size)
      if (currentSize === 0) return item
      if (itemSize === 0) return current
      return itemSize < currentSize ? item : current
    }, mp4Videos[0])
    return firstPlayAddrVideoUrl(smallest.play_addr)
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
    const url = firstPlayAddrVideoUrl(videosByQuality.get(level)?.[0]?.play_addr)
    if (url) return url
  }

  return firstPlayAddrVideoUrl(mp4Videos[0].play_addr)
}

const selectDouyinVideoUrl = (video: Record<string, any>, quality: DouyinQuality) => {
  return selectDouyinBitRateUrl(video.bit_rate, quality)
    || firstPlayAddrVideoUrl(video.play_addr)
    || firstPlayAddrVideoUrl(video.play_addr_h264)
    || firstPlayAddrVideoUrl(video.download_addr)
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

export const normalizeDouyinDetail = (
  pageUrl: string,
  payload: unknown,
  options: DouyinNormalizeOptions = {}
): ResolvedPost | ResolverFailure => {
  const root = asObject(payload)
  const detail = asObject(root?.aweme_detail) ?? asObject(root?.data?.aweme_detail)
  if (!detail) return failure('抖音接口返回异常')

  const images: string[] = []
  const videos: string[] = []
  const quality = normalizeQuality(options.quality)
  const maxVideoDurationSeconds = normalizeNumber(options.maxVideoDurationSeconds, 0)
  let limitMessage = ''

  for (const image of Array.isArray(detail.images) ? detail.images : []) {
    pushUnique(images, image?.url_list)
    const imageVideo = asObject(image?.video)
    if (imageVideo) pushUniqueVideo(videos, selectDouyinVideoUrl(imageVideo, quality))
  }

  const video = asObject(detail.video)
  if (video) {
    pushUnique(images, video.cover?.url_list)
    pushUnique(images, video.origin_cover?.url_list)

    const durationMs = normalizeNumber(video.duration, 0)
    const durationSeconds = durationMs > 1000 ? Math.trunc(durationMs / 1000) : durationMs
    const overDurationLimit = maxVideoDurationSeconds > 0 && durationSeconds > maxVideoDurationSeconds

    if (overDurationLimit) {
      limitMessage = `视频时长 ${durationSeconds} 秒，超过当前下载上限 ${maxVideoDurationSeconds} 秒，仅返回视频信息。`
    } else {
      pushUniqueVideo(videos, selectDouyinVideoUrl(video, quality))
    }
  }

  if (images.length === 0 && videos.length === 0) return failure('未找到抖音媒体资源')

  return {
    platform: 'douyin',
    displayName: '抖音',
    title: String(detail.desc || '抖音作品'),
    description: [String(detail.desc || ''), limitMessage].filter(Boolean).join('\n'),
    author: detail.author?.nickname,
    pageUrl,
    videos,
    images
  }
}

const expandShortUrl = async (url: string) => {
  if (!url.includes('v.douyin.com')) return url
  const response = await fetch(url, { redirect: 'follow' })
  return response.url || url
}

const downloadDouyinVideos = async (result: ResolvedPost, headers: Record<string, string>) => {
  if (result.videos.length === 0) return result

  const timeoutMs = Math.max(10, Config.runtime.downloadTimeoutSeconds) * 1000
  const videos: string[] = []
  let failedDownloads = 0
  for (const videoUrl of result.videos) {
    try {
      const rawVideo = await downloadFile({
        url: videoUrl,
        output: createTempFilePath('douyin', 'mp4'),
        headers,
        timeoutMs
      })
      try {
        videos.push(await runFfmpeg({
          input: rawVideo,
          output: createTempFilePath('douyin', 'mp4'),
          format: 'qq-video'
        }))
      } catch {
        videos.push(rawVideo)
      }
    } catch {
      failedDownloads += 1
    }
  }

  if (failedDownloads === 0) return { ...result, videos }

  const downloadMessage = videos.length > 0
    ? '部分视频下载失败，已跳过不可用视频。'
    : '视频下载失败，已仅返回作品信息。'

  return {
    ...result,
    videos,
    description: [result.description, downloadMessage].filter(Boolean).join('\n')
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

  const awemeId = extractDouyinAwemeId(finalUrl)
  if (cookie && awemeId) {
    try {
      const douyinConfig = Config.resolver.douyin
      const headers = {
        'Accept-Language': 'zh-CN,zh;q=0.8,zh-TW;q=0.7,zh-HK;q=0.5,en-US;q=0.3,en;q=0.2',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:118.0) Gecko/20100101 Firefox/118.0',
        Referer: 'https://www.douyin.com/',
        Cookie: cookie
      }
      const requestUrl = createDouyinDetailUrl(awemeId)
      const result = normalizeDouyinDetail(finalUrl, await fetchJson(requestUrl, { headers }), {
        quality: normalizeQuality(douyinConfig?.quality),
        maxVideoDurationSeconds: douyinConfig?.maxVideoDurationSeconds ?? Config.resolver.maxVideoDurationSeconds
      })
      if (!('ok' in result)) return downloadDouyinVideos(result, headers)
    } catch {
      // Fall back to configured general APIs.
    }
  }

  return resolveByGeneralApis('抖音', finalUrl, generalApis)
}
