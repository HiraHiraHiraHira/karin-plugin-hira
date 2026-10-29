import { afterEach, describe, expect, it, vi } from 'vitest'

import { extractDouyinAwemeId, normalizeDouyinDetail, normalizeDouyinSsrHtml, resolveDouyin } from '@/resolvers/douyin'
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

  it('keeps Douyin Live Photo galleries as static images instead of downloading embedded clips', () => {
    const result = normalizeDouyinDetail('https://www.douyin.com/note/739', {
      aweme_detail: {
        desc: 'Live Photo 图集',
        is_slides: true,
        images: [
          {
            clip_type: 5,
            url_list: ['https://img/live-1.webp', 'https://img/live-1-large.webp'],
            video: {
              play_addr_h264: { uri: 'v0200fg10000live1' }
            }
          },
          {
            clip_type: 5,
            url_list: ['https://img/live-2.webp'],
            video: {
              play_addr: { url_list: ['https://v3.douyinvod.com/video/tos/cn/live-2.mp4'] }
            }
          }
        ]
      }
    })

    expect(result).toMatchObject({
      platform: 'douyin',
      title: 'Live Photo 图集',
      images: ['https://img/live-1.webp', 'https://img/live-2.webp'],
      videos: []
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

  it('keeps KKK-style bit_rate url_list urls before generated play endpoints', () => {
    const result = normalizeDouyinDetail('https://www.douyin.com/video/738', {
      aweme_detail: {
        desc: '抖音标题',
        video: {
          cover: { url_list: ['https://img/cover.jpg'] },
          bit_rate: [{
            format: 'mp4',
            gear_name: 'normal_1080_0',
            play_addr: {
              uri: 'v0200fg10000stable',
              data_size: 1024,
              url_list: ['https://v3.douyinvod.com/video/tos/cn/expired.mp4?expire=1&sign=abc']
            }
          }]
        }
      }
    }, { quality: '1080p' })

    expect(result).toMatchObject({
      platform: 'douyin',
      videos: ['https://v3.douyinvod.com/video/tos/cn/expired.mp4?expire=1&sign=abc']
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
  it('parses inline SSR snapshots without cookies', () => {
    const html = `<html>${'<a>'.repeat(120)}<body><script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
      aweme_detail: {
        desc: 'SSR 作品',
        author: { nickname: '作者' },
        video: {
          cover: { url_list: ['https://cover.test/1.jpg'] },
          bit_rate: [{ format: 'mp4', gear_name: 'normal', play_addr: { url_list: ['https://video.test/1.mp4'] } }]
        }
      }
    })}</script></body></html>`
    const result = normalizeDouyinSsrHtml('https://www.douyin.com/video/123', html)
    expect('ok' in result).toBe(false)
    if (!('ok' in result)) {
      expect(result.videos[0]).toContain('video.test')
    }
  })

  it('rejects empty SSR snapshots', () => {
    const result = normalizeDouyinSsrHtml('https://www.douyin.com/video/123', '<html></html>')
    expect('ok' in result).toBe(true)
  })

  it('parses NEXT_DATA snapshots when more scripts follow', () => {
    const snapshot = JSON.stringify({
      aweme_detail: {
        desc: '多脚本页面',
        video: {
          duration: 12000,
          cover: { url_list: ['https://cover.test/multi.jpg'] },
          bit_rate: [{ format: 'mp4', gear_name: 'normal_1080_0', play_addr: { url_list: ['https://video.test/multi.mp4'] } }]
        }
      }
    })
    const html = `<html>${'<a>'.repeat(120)}<body>`
      + `<script id="__NEXT_DATA__" type="application/json">${snapshot}</script>`
      + '<script>var x=1</script><script>var y=2</script>'
      + '</body></html>'

    const result = normalizeDouyinSsrHtml('https://www.douyin.com/video/123', html)

    expect('ok' in result).toBe(false)
    if (!('ok' in result)) expect(result.videos[0]).toContain('multi.mp4')
  })

  it('parses universal rehydration snapshots when more scripts follow', () => {
    const snapshot = JSON.stringify({
      aweme_detail: {
        desc: '全局快照',
        video: {
          duration: 12000,
          cover: { url_list: ['https://cover.test/universal.jpg'] },
          bit_rate: [{ format: 'mp4', gear_name: 'normal_1080_0', play_addr: { url_list: ['https://video.test/universal.mp4'] } }]
        }
      },
      // 真实 SSR 快照远大于 {500,} 的下界,这里补足长度以覆盖该规则本身
      seo_abnormal: 'x'.repeat(400)
    })
    const html = `<html>${'<b>'.repeat(250)}<script>self.__UNIVERSAL_DATA_FOR_REHYDRATION__ = ${snapshot}</script>`
      + '<script>var trailing=1</script></html>'

    const result = normalizeDouyinSsrHtml('https://www.douyin.com/video/123', html)

    expect('ok' in result).toBe(false)
    if (!('ok' in result)) expect(result.videos[0]).toContain('universal.mp4')
  })

  it('extracts inline aweme_detail objects with nested fields', () => {
    // 快照里 aweme_detail 后面没有 video_list/log_pb 之类的固定后继键,
    // 旧的非贪婪正则依赖这些键名收尾,拿不到完整对象;深度扫描则与后继键无关
    const inline = {
      aweme_detail: {
        desc: '直嵌作品',
        video: {
          duration: 12000,
          cover: { url_list: ['https://cover.test/inline.jpg'] },
          bit_rate: [{
            format: 'mp4',
            gear_name: 'normal_1080_0',
            play_addr: {
              data_size: 4096,
              url_list: ['https://video.test/inline.mp4']
            }
          }]
        }
      }
    }
    // 无 __NEXT_DATA__ / __UNIVERSAL_DATA 前缀,只能走 aweme_detail 直嵌兜底
    const html = `<html>${'<!--pad-->'.repeat(40)}<script>window.__DATA__ = ${JSON.stringify(inline)}</script></html>`

    const result = normalizeDouyinSsrHtml('https://www.douyin.com/video/123', html)

    expect('ok' in result).toBe(false)
    if (!('ok' in result)) {
      expect(result.videos[0]).toContain('inline.mp4')
      expect(result.images).toContain('https://cover.test/inline.jpg')
    }
  })

  it('finds aweme_detail inside nested page props', () => {
    const result = normalizeDouyinDetail('https://www.douyin.com/video/738', {
      props: {
        pageProps: {
          aweme_detail: {
            desc: '页面参数作品',
            video: {
              duration: 12000,
              cover: { url_list: ['https://cover.test/props.jpg'] },
              bit_rate: [{ format: 'mp4', gear_name: 'normal_1080_0', play_addr: { url_list: ['https://video.test/props.mp4'] } }]
            }
          }
        }
      }
    })

    expect('ok' in result).toBe(false)
    if (!('ok' in result)) expect(result.videos[0]).toContain('props.mp4')
  })

  it('finds aweme_detail inside universal default scope', () => {
    const result = normalizeDouyinDetail('https://www.douyin.com/video/738', {
      __DEFAULT_SCOPE__: {
        'webapp.video-detail': {
          status_code: 0,
          aweme_detail: {
            desc: '全局作用域作品',
            video: {
              duration: 12000,
              cover: { url_list: ['https://cover.test/scope.jpg'] },
              bit_rate: [{ format: 'mp4', gear_name: 'normal_1080_0', play_addr: { url_list: ['https://video.test/scope.mp4'] } }]
            }
          }
        }
      }
    })

    expect('ok' in result).toBe(false)
    if (!('ok' in result)) expect(result.videos[0]).toContain('scope.mp4')
  })

  it('parses full NEXT_DATA page props snapshots', () => {
    const snapshot = JSON.stringify({
      props: {
        pageProps: {
          aweme_detail: {
            desc: '页面参数快照',
            author: { nickname: '作者' },
            video: {
              duration: 12000,
              cover: { url_list: ['https://cover.test/pageprops.jpg'] },
              bit_rate: [{ format: 'mp4', gear_name: 'normal_1080_0', play_addr: { url_list: ['https://video.test/pageprops.mp4'] } }]
            }
          }
        }
      },
      page: '/video/123',
      query: { aweme_id: '123' }
    })
    const html = `<html>${'<a>'.repeat(120)}<script id="__NEXT_DATA__" type="application/json">${snapshot}</script>`
      + '<script>var x=1</script></html>'

    const result = normalizeDouyinSsrHtml('https://www.douyin.com/video/123', html)

    expect('ok' in result).toBe(false)
    if (!('ok' in result)) expect(result.videos[0]).toContain('pageprops.mp4')
  })

  it('rejects deeply nested payloads without aweme_detail', () => {
    const result = normalizeDouyinDetail('https://www.douyin.com/video/738', {
      props: {
        pageProps: {
          data: {
            list: [{ video: { play_addr: { url_list: ['https://video.test/not-aweme.mp4'] } } }]
          }
        }
      }
    })

    expect(result).toMatchObject({ platform: 'douyin', ok: false })
  })

  it('applies the configured duration limit to SSR snapshots', () => {
    const html = `<html>${'<a>'.repeat(120)}<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
      aweme_detail: {
        desc: '超长作品',
        video: {
          duration: 900_000,
          cover: { url_list: ['https://cover.test/long.jpg'] },
          bit_rate: [{ format: 'mp4', gear_name: 'normal_1080_0', play_addr: { url_list: ['https://video.test/long.mp4'] } }]
        }
      }
    })}</script></html>`

    const result = normalizeDouyinSsrHtml('https://www.douyin.com/video/123', html, { maxVideoDurationSeconds: 480 })

    expect('ok' in result).toBe(false)
    if ('ok' in result) throw new Error('expected successful normalization')
    expect(result.videos).toEqual([])
    expect(result.description).toContain('超过当前下载上限 480 秒')
  })

  it('keeps SSR downloads inside the configured duration limit', async () => {
    const html = `<html>${'<a>'.repeat(120)}<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
      aweme_detail: {
        desc: '超长作品',
        video: {
          duration: 900_000,
          cover: { url_list: ['https://cover.test/long.jpg'] },
          bit_rate: [{ format: 'mp4', gear_name: 'normal_1080_0', play_addr: { url_list: ['https://video.test/long.mp4'] } }]
        }
      }
    })}</script></html>`
    const fetchMock = vi.fn(async () => new Response(html, { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await resolveDouyin('https://www.douyin.com/video/7380000000000000000', '', [])

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('douyin.com/video/7380000000000000000'),
      expect.objectContaining({ headers: expect.objectContaining({ Referer: 'https://www.douyin.com/' }) })
    )
    expect(runtimeMocks.downloadFile).not.toHaveBeenCalled()
    expect('ok' in result).toBe(false)
    if ('ok' in result) throw new Error('expected successful result')
    expect(result.videos).toEqual([])
    expect(result.description).toContain('超过当前下载上限 480 秒')
  })
})
