import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  createBilibiliPlayUrl,
  extractBvid,
  normalizeBilibiliVideoInfo,
  resolveBilibili,
  selectBestBilibiliStream
} from '@/resolvers/bilibili'
import { downloadFile } from '@/runtime/downloader'
import { runFfmpeg } from '@/runtime/ffmpeg'

const runtimeMocks = vi.hoisted(() => ({
  downloadFile: vi.fn(async (options: { output: string }) => options.output),
  runFfmpeg: vi.fn(async (options: { output: string }) => options.output),
  createTempFilePath: vi.fn((scope: string, ext: string) => `D:/tmp/${scope}-${ext}-${Math.random().toString(36).slice(2)}.${ext}`)
}))

vi.mock('@/runtime/downloader', () => ({
  downloadFile: runtimeMocks.downloadFile
}))

vi.mock('@/runtime/ffmpeg', async importOriginal => {
  const actual = await importOriginal<typeof import('@/runtime/ffmpeg')>()
  return {
    ...actual,
    runFfmpeg: runtimeMocks.runFfmpeg
  }
})

vi.mock('@/runtime/temp', () => ({
  createTempFilePath: runtimeMocks.createTempFilePath
}))

describe('bilibili resolver helpers', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it('extracts bvid from ordinary video links', () => {
    expect(extractBvid('https://www.bilibili.com/video/BV14A31eZEH8?p=2')).toBe('BV14A31eZEH8')
    expect(extractBvid('https://m.bilibili.com/video/BV1xx411c7mD')).toBe('BV1xx411c7mD')
  })

  it('normalizes video info payloads', () => {
    const result = normalizeBilibiliVideoInfo('https://www.bilibili.com/video/BV14A31eZEH8', {
      code: 0,
      data: {
        bvid: 'BV14A31eZEH8',
        title: '视频标题',
        desc: '简介',
        pic: 'https://i0.hdslb.com/cover.jpg',
        owner: { name: 'UP主' },
        stat: { view: 100, like: 20, reply: 3 }
      }
    })

    expect(result).toMatchObject({
      platform: 'bilibili',
      displayName: '哔哩哔哩',
      title: '视频标题',
      author: 'UP主',
      pageUrl: 'https://www.bilibili.com/video/BV14A31eZEH8',
      images: ['https://i0.hdslb.com/cover.jpg'],
      videos: []
    })
    expect('ok' in result).toBe(false)
    if ('ok' in result) throw new Error('expected successful result')
    expect(result.description).toContain('简介')
    expect(result.description).toContain('播放：100')
  })

  it('returns a failure for missing API data', () => {
    expect(normalizeBilibiliVideoInfo('https://www.bilibili.com/video/BV14A31eZEH8', {
      code: -404,
      message: '啥都木有'
    })).toMatchObject({
      platform: 'bilibili',
      ok: false
    })
  })

  it('builds playurl requests with configured quality', () => {
    const requestUrl = new URL(createBilibiliPlayUrl('BV14A31eZEH8', 456, 80))

    expect(requestUrl.searchParams.get('bvid')).toBe('BV14A31eZEH8')
    expect(requestUrl.searchParams.get('cid')).toBe('456')
    expect(requestUrl.searchParams.get('qn')).toBe('80')
    expect(requestUrl.searchParams.get('fnval')).toBe('16')
  })

  it('selects Bilibili DASH streams by configured codec preference', () => {
    const streams = [
      { id: 64, codecs: 'hev1.1.6.L120.90', baseUrl: 'https://video.example.test/hevc.m4s', bandwidth: 3000 },
      { id: 64, codecs: 'avc1.640028', baseUrl: 'https://video.example.test/avc.m4s', bandwidth: 2000 },
      { id: 64, codecs: 'av01.0.08M.08', baseUrl: 'https://video.example.test/av1.m4s', bandwidth: 1000 }
    ]

    expect(selectBestBilibiliStream(streams, 'avc')?.url).toBe('https://video.example.test/avc.m4s')
    expect(selectBestBilibiliStream(streams, 'hevc')?.url).toBe('https://video.example.test/hevc.m4s')
    expect(selectBestBilibiliStream(streams, 'av1')?.url).toBe('https://video.example.test/av1.m4s')
    expect(selectBestBilibiliStream(streams, 'auto')?.url).toBe('https://video.example.test/hevc.m4s')
  })

  it('prefers the lower bitrate stream when quality and codec are equivalent', () => {
    const streams = [
      { id: 64, codecs: 'avc1.640028', baseUrl: 'https://video.example.test/avc-large.m4s', bandwidth: 18000000 },
      { id: 64, codecs: 'avc1.640028', baseUrl: 'https://video.example.test/avc-small.m4s', bandwidth: 2200000 }
    ]

    expect(selectBestBilibiliStream(streams, 'avc')?.url).toBe('https://video.example.test/avc-small.m4s')
  })

  it('resolves Bilibili playurl media instead of returning only metadata', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('/x/web-interface/view')) {
        return new Response(JSON.stringify({
          code: 0,
          data: {
            aid: 123,
            bvid: 'BV14A31eZEH8',
            cid: 456,
            title: '视频标题',
            pic: 'https://i0.hdslb.com/cover.jpg',
            owner: { name: 'UP主' },
            duration: 120
          }
        }), { status: 200 })
      }

      if (url.includes('/x/player/playurl')) {
        return new Response(JSON.stringify({
          code: 0,
          data: {
            durl: [{ url: 'https://video.example.test/bilibili.mp4' }]
          }
        }), { status: 200 })
      }

      throw new Error(`unexpected url: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await resolveBilibili('https://www.bilibili.com/video/BV14A31eZEH8')

    expect(result).toMatchObject({
      platform: 'bilibili',
      title: '视频标题',
      videos: ['https://video.example.test/bilibili.mp4']
    })
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/x/player/playurl'),
      expect.objectContaining({
        headers: expect.objectContaining({
          Referer: 'https://www.bilibili.com/video/BV14A31eZEH8'
        })
      })
    )
  })

  it('downloads and merges DASH video and audio streams for Bilibili videos', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('/x/web-interface/view')) {
        return new Response(JSON.stringify({
          code: 0,
          data: {
            aid: 123,
            bvid: 'BV14A31eZEH8',
            cid: 456,
            title: '视频标题',
            pic: 'https://i0.hdslb.com/cover.jpg',
            owner: { name: 'UP主' },
            duration: 120
          }
        }), { status: 200 })
      }

      if (url.includes('/x/player/playurl')) {
        return new Response(JSON.stringify({
          code: 0,
          data: {
            dash: {
              video: [
                { id: 32, baseUrl: 'https://video.example.test/low.m4s', bandwidth: 1000 },
                { id: 64, baseUrl: 'https://video.example.test/high.m4s', bandwidth: 2000 }
              ],
              audio: [
                { id: 30216, baseUrl: 'https://audio.example.test/audio.m4s' }
              ]
            }
          }
        }), { status: 200 })
      }

      throw new Error(`unexpected url: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await resolveBilibili('https://www.bilibili.com/video/BV14A31eZEH8')

    expect('ok' in result).toBe(false)
    if ('ok' in result) throw new Error('expected successful result')
    expect(result.videos).toHaveLength(1)
    expect(result.videos[0]).toMatch(/\.mp4$/)
    expect(downloadFile).toHaveBeenCalledWith(expect.objectContaining({
      url: 'https://video.example.test/high.m4s',
      headers: expect.objectContaining({
        Referer: 'https://www.bilibili.com/video/BV14A31eZEH8'
      })
    }))
    expect(downloadFile).toHaveBeenCalledWith(expect.objectContaining({
      url: 'https://audio.example.test/audio.m4s'
    }))
    expect(runFfmpeg).toHaveBeenCalledWith(expect.objectContaining({
      format: 'merge',
      output: result.videos[0]
    }))
  })

  it('prefers DASH streams over durl when both are available', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('/x/web-interface/view')) {
        return new Response(JSON.stringify({
          code: 0,
          data: {
            aid: 123,
            bvid: 'BV14A31eZEH8',
            cid: 456,
            title: '视频标题',
            pic: 'https://i0.hdslb.com/cover.jpg',
            owner: { name: 'UP主' },
            duration: 120
          }
        }), { status: 200 })
      }

      if (url.includes('/x/player/playurl')) {
        return new Response(JSON.stringify({
          code: 0,
          data: {
            durl: [{ url: 'https://video.example.test/oversized-progressive.mp4' }],
            dash: {
              video: [
                { id: 64, codecs: 'avc1.640028', baseUrl: 'https://video.example.test/compact-720p.m4s', bandwidth: 2200000 }
              ],
              audio: [
                { id: 30216, baseUrl: 'https://audio.example.test/audio.m4s' }
              ]
            }
          }
        }), { status: 200 })
      }

      throw new Error(`unexpected url: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await resolveBilibili('https://www.bilibili.com/video/BV14A31eZEH8')

    expect('ok' in result).toBe(false)
    if ('ok' in result) throw new Error('expected successful result')
    expect(result.videos).not.toContain('https://video.example.test/oversized-progressive.mp4')
    expect(downloadFile).toHaveBeenCalledWith(expect.objectContaining({
      url: 'https://video.example.test/compact-720p.m4s'
    }))
    expect(runFfmpeg).toHaveBeenCalled()
  })
})
