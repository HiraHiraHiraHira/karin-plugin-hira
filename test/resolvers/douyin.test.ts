import { afterEach, describe, expect, it, vi } from 'vitest'

import { extractDouyinAwemeId, normalizeDouyinDetail, resolveDouyin } from '@/resolvers/douyin'
import { downloadFile } from '@/runtime/downloader'
import { runFfmpeg } from '@/runtime/ffmpeg'

const runtimeMocks = vi.hoisted(() => {
  let tempIndex = 0
  return {
    downloadFile: vi.fn(async (options: { output: string }) => options.output),
    createTempFilePath: vi.fn((scope: string, ext: string) => `D:/tmp/${scope}-${tempIndex++}.${ext}`),
    resetTempIndex: () => { tempIndex = 0 },
    runFfmpeg: vi.fn(async (options: { output: string }) => options.output)
  }
})

vi.mock('@/runtime/downloader', () => ({
  downloadFile: runtimeMocks.downloadFile
}))

vi.mock('@/runtime/temp', () => ({
  createTempFilePath: runtimeMocks.createTempFilePath
}))

vi.mock('@/runtime/ffmpeg', () => ({
  runFfmpeg: runtimeMocks.runFfmpeg
}))

describe('douyin resolver helpers', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
    runtimeMocks.resetTempIndex()
  })

  it('extracts aweme ids from video and note links', () => {
    expect(extractDouyinAwemeId('https://www.douyin.com/video/7380000000000000000')).toBe('7380000000000000000')
    expect(extractDouyinAwemeId('https://www.douyin.com/note/7390000000000000000')).toBe('7390000000000000000')
    expect(extractDouyinAwemeId('https://www.douyin.com/share/video/7400000000000000000')).toBe('7400000000000000000')
  })

  it('normalizes video detail payloads', () => {
    const result = normalizeDouyinDetail('https://www.douyin.com/video/738', {
      aweme_detail: {
        desc: '抖音标题',
        author: { nickname: '作者' },
        video: {
          cover: { url_list: ['https://img/cover.jpg'] },
          play_addr: { url_list: ['https://video/a.mp4'] }
        },
        images: [{ url_list: ['https://img/a.jpg'] }]
      }
    })

    expect(result).toMatchObject({
      platform: 'douyin',
      displayName: '抖音',
      title: '抖音标题',
      author: '作者',
      images: ['https://img/a.jpg', 'https://img/cover.jpg'],
      videos: ['https://video/a.mp4']
    })
    expect('ok' in result).toBe(false)
  })

  it('selects KKK-style bit_rate mp4 urls by configured quality and filters bgm audio urls', () => {
    const result = normalizeDouyinDetail('https://www.douyin.com/video/738', {
      aweme_detail: {
        desc: '抖音标题',
        author: { nickname: '作者' },
        video: {
          cover: { url_list: ['https://img/cover.jpg'] },
          bit_rate: [
            {
              format: 'dash',
              gear_name: 'adapt_1080',
              play_addr: {
                data_size: 2048,
                url_list: ['https://video.example.test/dash.mpd']
              }
            },
            {
              format: 'mp4',
              gear_name: 'normal_1080_0',
              play_addr: {
                data_size: 4096,
                url_list: [
                  'https://v3.douyinvod.com/video/tos/cn/tos-cn-ve.mp4',
                  'https://www.douyin.com/aweme/v1/play/?video_id=wrapped'
                ]
              }
            },
            {
              format: 'mp4',
              gear_name: 'normal_720_0',
              play_addr: {
                data_size: 1024,
                url_list: ['https://v3.douyinvod.com/video/tos/cn/720.mp4']
              }
            }
          ],
          play_addr: {
            uri: 'v0200fg10000abc',
            url_list: ['https://p3.douyinpic.com/obj/ies-music/not-video.mp3']
          }
        },
        music: {
          play_url: { url_list: ['https://p3.douyinpic.com/obj/ies-music/bgm.mp3'] }
        }
      }
    }, { quality: '720p' })

    expect(result).toMatchObject({
      platform: 'douyin',
      videos: ['https://v3.douyinvod.com/video/tos/cn/720.mp4'],
      images: ['https://img/cover.jpg']
    })
  })

  it('returns only metadata and cover when Douyin video exceeds the configured limit', () => {
    const result = normalizeDouyinDetail('https://www.douyin.com/video/738', {
      aweme_detail: {
        desc: '长视频',
        video: {
          duration: 180000,
          cover: { url_list: ['https://img/cover.jpg'] },
          play_addr: { uri: 'v0200fg10000abc' }
        }
      }
    }, { maxVideoDurationSeconds: 60 })

    expect(result).toMatchObject({
      platform: 'douyin',
      title: '长视频',
      videos: [],
      images: ['https://img/cover.jpg']
    })
    expect('ok' in result).toBe(false)
    if ('ok' in result) throw new Error('expected successful result')
    expect(result.description).toContain('超过当前下载上限 60 秒')
  })

  it('downloads direct Douyin videos before returning them for upload', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('/aweme/v1/web/aweme/detail/')) {
        return new Response(JSON.stringify({
          aweme_detail: {
            desc: '抖音标题',
            author: { nickname: '作者' },
            video: {
              duration: 12000,
              cover: { url_list: ['https://img/cover.jpg'] },
              bit_rate: [{
                format: 'mp4',
                gear_name: 'normal_1080_0',
                play_addr: {
                  data_size: 1024,
                  url_list: ['https://v3.douyinvod.com/video/tos/cn/video.mp4']
                }
              }]
            }
          }
        }), { status: 200 })
      }

      throw new Error(`unexpected url: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await resolveDouyin('https://www.douyin.com/video/7380000000000000000', 'cookie=value', [])

    expect(result).toMatchObject({
      platform: 'douyin',
      videos: ['D:/tmp/douyin-1.mp4']
    })
    expect(downloadFile).toHaveBeenCalledWith(expect.objectContaining({
      url: 'https://v3.douyinvod.com/video/tos/cn/video.mp4',
      output: 'D:/tmp/douyin-0.mp4',
      headers: expect.objectContaining({
        Referer: 'https://www.douyin.com/'
      })
    }))
    expect(runFfmpeg).toHaveBeenCalledWith({
      input: 'D:/tmp/douyin-0.mp4',
      output: 'D:/tmp/douyin-1.mp4',
      format: 'qq-video'
    })
  })

  it('falls back to the downloaded Douyin video when compatibility remux fails', async () => {
    runtimeMocks.runFfmpeg.mockRejectedValueOnce(new Error('ffmpeg failed'))
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('/aweme/v1/web/aweme/detail/')) {
        return new Response(JSON.stringify({
          aweme_detail: {
            desc: '抖音标题',
            video: {
              duration: 12000,
              cover: { url_list: ['https://img/cover.jpg'] },
              bit_rate: [{
                format: 'mp4',
                gear_name: 'normal_1080_0',
                play_addr: {
                  data_size: 1024,
                  url_list: ['https://v3.douyinvod.com/video/tos/cn/video.mp4']
                }
              }]
            }
          }
        }), { status: 200 })
      }

      throw new Error(`unexpected url: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await resolveDouyin('https://www.douyin.com/video/7380000000000000000', 'cookie=value', [])

    expect(result).toMatchObject({
      platform: 'douyin',
      videos: ['D:/tmp/douyin-0.mp4']
    })
  })

  it('does not return expiring remote Douyin video urls when download fails', async () => {
    runtimeMocks.downloadFile.mockRejectedValueOnce(new Error('download failed'))
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('/aweme/v1/web/aweme/detail/')) {
        return new Response(JSON.stringify({
          aweme_detail: {
            desc: '抖音标题',
            video: {
              duration: 12000,
              cover: { url_list: ['https://img/cover.jpg'] },
              bit_rate: [{
                format: 'mp4',
                gear_name: 'normal_1080_0',
                play_addr: {
                  data_size: 1024,
                  url_list: ['https://v3.douyinvod.com/video/tos/cn/video.mp4']
                }
              }]
            }
          }
        }), { status: 200 })
      }

      throw new Error(`unexpected url: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await resolveDouyin('https://www.douyin.com/video/7380000000000000000', 'cookie=value', [])

    expect(result).toMatchObject({
      platform: 'douyin',
      videos: [],
      images: ['https://img/cover.jpg']
    })
    expect('ok' in result).toBe(false)
    if ('ok' in result) throw new Error('expected successful result')
    expect(result.description).toContain('视频下载失败，已仅返回作品信息')
  })

  it('returns a failure when no media exists', () => {
    expect(normalizeDouyinDetail('https://www.douyin.com/video/738', {
      aweme_detail: { desc: '空内容' }
    })).toMatchObject({
      platform: 'douyin',
      ok: false
    })
  })
})
