import { Config } from '@/config'
import { downloadFile } from '@/runtime/downloader'
import { runFfmpeg } from '@/runtime/ffmpeg'
import { createTempFilePath } from '@/runtime/temp'
import { fetchJson } from '@/services/http'
import type { ResolverConfig } from '@/types/config'

import type { ResolvedPost, ResolverFailure, ResolverResult, RichContentBlock } from './types'

const failure = (reason: string): ResolverFailure => ({
  platform: 'bilibili',
  displayName: '哔哩哔哩',
  ok: false,
  reason
})

const asObject = (value: unknown): Record<string, any> | undefined => {
  return typeof value === 'object' && value !== null ? value as Record<string, any> : undefined
}

const bvidPattern = /BV[0-9A-Za-z]{10}/i

export const extractBvid = (url: string) => {
  return url.match(bvidPattern)?.[0]
}

const formatStat = (label: string, value: unknown) => {
  return typeof value === 'number' ? `${label}：${value}` : ''
}

const getMediaUrl = (value: unknown): string | undefined => {
  const item = asObject(value)
  const url = item?.url || item?.baseUrl || item?.base_url || item?.backupUrl?.[0] || item?.backup_url?.[0]
  return typeof url === 'string' && url ? url : undefined
}

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

const codecPreferenceRank = (codecs: string, preference: BilibiliCodecPreference) => {
  if (preference === 'auto') {
    const family = codecFamily(codecs)
    if (family === 'hevc') return 0
    if (family === 'av1') return 1
    if (family === 'avc') return 2
    return 3
  }
  return codecFamily(codecs) === preference ? 0 : 1
}

const selectBilibiliDurl = (payload: unknown) => {
  const root = asObject(payload)
  const data = asObject(root?.data)
  if (Number(root?.code) !== 0 || !data) return undefined

  const durl = Array.isArray(data.durl) ? data.durl : []
  return getMediaUrl(durl[0])
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
        url: getMediaUrl(item)
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
  const root = asObject(payload)
  const data = asObject(root?.data)
  const dash = asObject(data?.dash)
  const videos = Array.isArray(dash?.video) ? dash.video : []
  const audios = Array.isArray(dash?.audio) ? dash.audio : []
  const video = selectBestBilibiliStream(videos, codecPreference, maxQuality)
  const audio = selectBestBilibiliStream(audios, 'auto')
  return video && audio ? { videoUrl: video.url, audioUrl: audio.url } : undefined
}

export const createBilibiliPlayUrl = (bvid: string, cid: number | string, quality: number | string = 64) => {
  const url = new URL('https://api.bilibili.com/x/player/playurl')
  url.searchParams.set('bvid', bvid)
  url.searchParams.set('cid', String(cid))
  url.searchParams.set('qn', String(Math.trunc(normalizeNumber(quality, 64))))
  url.searchParams.set('fnval', '16')
  url.searchParams.set('fnver', '0')
  url.searchParams.set('fourk', '1')
  return url.toString()
}

const resolveDashVideo = async (media: { videoUrl: string, audioUrl: string }, headers: Record<string, string>) => {
  const timeoutMs = Math.max(10, Config.runtime.downloadTimeoutSeconds) * 1000
  const videoInput = createTempFilePath('bilibili', 'm4s')
  const audioInput = createTempFilePath('bilibili', 'm4s')
  const output = createTempFilePath('bilibili', 'mp4')

  await Promise.all([
    downloadFile({ url: media.videoUrl, output: videoInput, headers, timeoutMs }),
    downloadFile({ url: media.audioUrl, output: audioInput, headers, timeoutMs })
  ])

  return runFfmpeg({
    format: 'merge',
    videoInput,
    audioInput,
    output
  })
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
  const description = [
    desc,
    stat
      ? [
          formatStat('播放', stat.view),
          formatStat('点赞', stat.like),
          formatStat('评论', stat.reply)
        ].filter(Boolean).join(' | ')
      : ''
  ].map(item => String(item || '').trim()).filter(Boolean).join('\n')

  const bvid = String(data.bvid || extractBvid(pageUrl) || '')

  return {
    platform: 'bilibili',
    displayName: '哔哩哔哩',
    title: String(data.title || 'B站视频'),
    description,
    author: typeof owner?.name === 'string' ? owner.name : undefined,
    pageUrl: bvid ? `https://www.bilibili.com/video/${bvid}` : pageUrl,
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
  const parsed = new URL(url)
  if (parsed.hostname !== 'b23.tv' && parsed.hostname !== 'bili2233.cn') return url

  const response = await fetch(url, { redirect: 'follow' })
  return response.url || url
}

export const resolveBilibili = async (url: string, cookie = ''): Promise<ResolverResult> => {
  let finalUrl = url
  try {
    finalUrl = await expandShortUrl(url)
  } catch {
    finalUrl = url
  }

  const bvid = extractBvid(finalUrl)
  if (!bvid) return failure('无法识别 BVID')

  const headers: Record<string, string> = {
    Referer: 'https://www.bilibili.com/'
  }
  if (cookie) headers.Cookie = cookie

  const payload = await fetchJson(`https://api.bilibili.com/x/web-interface/view?bvid=${encodeURIComponent(bvid)}`, { headers })
  const result = normalizeBilibiliVideoInfo(finalUrl, payload)
  if ('ok' in result) return result

  const data = asObject(asObject(payload)?.data)
  const cid = data?.cid
  const duration = Number(data?.duration ?? 0)
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

  const pageUrl = result.pageUrl || finalUrl
  const mediaHeaders = {
    ...headers,
    Referer: pageUrl
  }
  const quality = normalizeNumber(bilibiliConfig?.quality, 64)
  const codec = normalizeCodecPreference(bilibiliConfig?.codec)
  const playPayload = await fetchJson(createBilibiliPlayUrl(bvid, String(cid), quality), { headers: mediaHeaders })
  const dash = selectBilibiliDash(playPayload, codec, quality)
  if (!dash) {
    const durl = selectBilibiliDurl(playPayload)
    return durl ? { ...result, videos: [durl] } : result
  }

  const video = await resolveDashVideo(dash, mediaHeaders)
  return { ...result, videos: [video] }
}
