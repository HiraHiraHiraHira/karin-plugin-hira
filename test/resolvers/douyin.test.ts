import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  classifyDouyinUrl,
  extractDouyinAwemeId,
  normalizeDouyinDetail,
  normalizeDouyinSsrHtml,
  resolveDouyin
} from '@/resolvers/douyin'
import { downloadFile } from '@/runtime/downloader'
import { runFfmpeg } from '@/runtime/ffmpeg'

const runtimeMocks = vi.hoisted(() => ({
  downloadFile: vi.fn(async (options: { output: string }) => options.output),
  runFfmpeg: vi.fn(async (options: { output: string }) => options.output)
}))

vi.mock('@/runtime/downloader', () => ({
  downloadFile: runtimeMocks.downloadFile
}))

vi.mock('@/runtime/ffmpeg', () => ({
  runFfmpeg: runtimeMocks.runFfmpeg
}))

describe('douyin resolver helpers', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it('extracts aweme ids from video and note links', () => {
    expect(extractDouyinAwemeId('https://www.douyin.com/video/7380000000000000000')).toBe('7380000000000000000')
    expect(extractDouyinAwemeId('https://www.douyin.com/note/7390000000000000000')).toBe('7390000000000000000')
    expect(extractDouyinAwemeId('https://www.douyin.com/share/video/7400000000000000000')).toBe('7400000000000000000')
    expect(extractDouyinAwemeId('https://www.douyin.com/discover?modal_id=7410000000000000000')).toBe('7410000000000000000')
  })

  it('classifies live rooms apart from regular works', () => {
    expect(classifyDouyinUrl('https://live.douyin.com/123456')).toEqual({ kind: 'live', roomId: '123456', via: 'enter' })
    expect(classifyDouyinUrl('https://www.douyin.com/live/123456')).toEqual({ kind: 'live', roomId: '123456', via: 'enter' })
    expect(classifyDouyinUrl('https://webcast.amemv.com/douyin/webcast/reflow/7654321?anchor_id=1')).toEqual({
      kind: 'live',
      roomId: '7654321',
      via: 'reflow'
    })
    expect(classifyDouyinUrl('https://www.douyin.com/video/7380000000000000000')).toEqual({
      kind: 'work',
      awemeId: '7380000000000000000'
    })
  })

  it('normalizes video detail payloads into remote stream references', () => {
    const result = normalizeDouyinDetail('https://www.douyin.com/video/738', {
      aweme_detail: {
        desc: '抖音标题',
        author: { nickname: '作者', avatar_thumb: { url_list: ['https://img/avatar.jpg'] } },
        video: {
          cover: { url_list: ['https://img/cover.jpg'] },
          play_addr: { url_list: ['https://video/a.mp4'] }
        }
      }
    })

    expect(result).toMatchObject({
      platform: 'douyin',
      displayName: '抖音',
      title: '抖音标题',
      author: '作者',
      images: ['https://img/cover.jpg'],
      videos: [{ url: 'https://video/a.mp4' }],
      extras: { coverUrl: 'https://img/cover.jpg', authorAvatar: 'https://img/avatar.jpg' }
    })
    expect('ok' in result).toBe(false)
  })

  it('registers every animated clip with the album BGM as a separate audio track', () => {
    const result = normalizeDouyinDetail('https://www.douyin.com/note/739', {
      aweme_detail: {
        desc: '动图图集',
        is_slides: true,
        images: [
          {
            clip_type: 5,
            url_list: ['https://img/live-1.webp'],
            video: { play_addr: { url_list: ['https://v3.douyinvod.com/video/live-1.mp4'] } }
          },
          { clip_type: 2, url_list: ['https://img/static-2.jpg'] },
          {
            clip_type: 5,
            url_list: ['https://img/live-3.webp'],
            video: { play_addr_h264: { uri: 'v0200fg10000live3' } }
          }
        ],
        music: { play_url: { url_list: ['https://p3.douyinpic.com/obj/ies-music/bgm.mp3'] } }
      }
    })

    if ('ok' in result) throw new Error('expected successful result')
    // 带 clip 的项只发视频, 静帧只保留没有 clip 的那些 —— images/videos 不重叠
    expect(result.images).toEqual(['https://img/static-2.jpg'])
    expect(result.videos).toHaveLength(2)
    expect(result.videos[0]).toEqual({
      url: 'https://v3.douyinvod.com/video/live-1.mp4',
      audioUrl: 'https://p3.douyinpic.com/obj/ies-music/bgm.mp3'
    })
    expect(result.videos[1].url).toContain('video_id=v0200fg10000live3')
    expect(result.videos[1].audioUrl).toBe('https://p3.douyinpic.com/obj/ies-music/bgm.mp3')
  })

  it('keeps the album cover as an image when every item is an animated clip', () => {
    const result = normalizeDouyinDetail('https://www.douyin.com/note/739', {
      aweme_detail: {
        desc: '全动图',
        images: [{
          clip_type: 5,
          url_list: ['https://img/live-1.webp'],
          video: { play_addr: { url_list: ['https://v3.douyinvod.com/video/live-1.mp4'] } }
        }],
        video: { cover: { url_list: ['https://img/album-cover.jpg'] } }
      }
    })

    if ('ok' in result) throw new Error('expected successful result')
    expect(result.images).toEqual(['https://img/album-cover.jpg'])
    expect(result.videos).toEqual([{ url: 'https://v3.douyinvod.com/video/live-1.mp4' }])
    expect(result.extras?.coverUrl).toBe('https://img/album-cover.jpg')
  })

  it('leaves clips without a BGM when the album is marked as original sound', () => {
    const result = normalizeDouyinDetail('https://www.douyin.com/note/739', {
      aweme_detail: {
        desc: '原声图集',
        is_use_music: false,
        images: [{
          clip_type: 5,
          url_list: ['https://img/live-1.webp'],
          video: { play_addr: { url_list: ['https://v3.douyinvod.com/video/live-1.mp4'] } }
        }],
        music: { play_url: { url_list: ['https://p3.douyinpic.com/obj/ies-music/bgm.mp3'] } }
      }
    })

    if ('ok' in result) throw new Error('expected successful result')
    expect(result.videos).toEqual([{ url: 'https://v3.douyinvod.com/video/live-1.mp4' }])
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
              play_addr: { data_size: 2048, url_list: ['https://video.example.test/dash.mpd'] }
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
              play_addr: { data_size: 1024, url_list: ['https://v3.douyinvod.com/video/tos/cn/720.mp4'] }
            }
          ],
          play_addr: {
            uri: 'v0200fg10000abc',
            url_list: ['https://p3.douyinpic.com/obj/ies-music/not-video.mp3']
          }
        },
        music: { play_url: { url_list: ['https://p3.douyinpic.com/obj/ies-music/bgm.mp3'] } }
      }
    }, { quality: '720p' })

    expect(result).toMatchObject({
      platform: 'douyin',
      videos: [{ url: 'https://v3.douyinvod.com/video/tos/cn/720.mp4' }],
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
      videos: [{ url: 'https://v3.douyinvod.com/video/tos/cn/expired.mp4?expire=1&sign=abc' }]
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

  it('treats sub-1000 duration values as seconds instead of dividing them by 1000', () => {
    const inSeconds = normalizeDouyinDetail('https://www.douyin.com/video/738', {
      aweme_detail: {
        desc: '秒级时长',
        video: { duration: 90, cover: { url_list: ['https://img/cover-seconds.jpg'] }, play_addr: { url_list: ['https://video/seconds.mp4'] } }
      }
    }, { maxVideoDurationSeconds: 60 })
    if ('ok' in inSeconds) throw new Error('expected successful result')
    expect(inSeconds.videos).toEqual([])
    expect(inSeconds.description).toContain('视频时长 90 秒')

    const inMilliseconds = normalizeDouyinDetail('https://www.douyin.com/video/738', {
      aweme_detail: {
        desc: '毫秒级时长',
        video: { duration: 90000, cover: { url_list: ['https://img/cover-millis.jpg'] }, play_addr: { url_list: ['https://video/millis.mp4'] } }
      }
    }, { maxVideoDurationSeconds: 60 })
    if ('ok' in inMilliseconds) throw new Error('expected successful result')
    expect(inMilliseconds.videos).toEqual([])
    expect(inMilliseconds.description).toContain('视频时长 90 秒')
  })

  it('returns remote Douyin video urls without downloading them', async () => {
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
                play_addr: { data_size: 1024, url_list: ['https://v3.douyinvod.com/video/tos/cn/video.mp4'] }
              }]
            }
          }
        }), { status: 200 })
      }
      throw new Error(`unexpected url: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await resolveDouyin('https://www.douyin.com/video/7380000000000000000', 'cookie=value', [])

    if ('ok' in result) throw new Error('expected successful result')
    expect(result.videos).toEqual([{ url: 'https://v3.douyinvod.com/video/tos/cn/video.mp4' }])
    expect(runtimeMocks.downloadFile).not.toHaveBeenCalled()
    expect(runtimeMocks.runFfmpeg).not.toHaveBeenCalled()
  })

  it('returns a failure when no media exists', () => {
    expect(normalizeDouyinDetail('https://www.douyin.com/video/738', {
      aweme_detail: { desc: '空内容' }
    })).toMatchObject({ platform: 'douyin', ok: false })
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
    if ('ok' in result) throw new Error('expected successful result')
    expect(result.videos[0].url).toContain('video.test')
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

    if ('ok' in result) throw new Error('expected successful result')
    expect(result.videos[0].url).toContain('multi.mp4')
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

    if ('ok' in result) throw new Error('expected successful result')
    expect(result.videos[0].url).toContain('universal.mp4')
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
          bit_rate: [{ format: 'mp4', gear_name: 'normal_1080_0', play_addr: { data_size: 4096, url_list: ['https://video.test/inline.mp4'] } }]
        }
      }
    }
    // 无 __NEXT_DATA__ / __UNIVERSAL_DATA 前缀,只能走 aweme_detail 直嵌兜底
    const html = `<html>${'<!--pad-->'.repeat(40)}<script>window.__DATA__ = ${JSON.stringify(inline)}</script></html>`

    const result = normalizeDouyinSsrHtml('https://www.douyin.com/video/123', html)

    if ('ok' in result) throw new Error('expected successful result')
    expect(result.videos[0].url).toContain('inline.mp4')
    expect(result.images).toContain('https://cover.test/inline.jpg')
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

    if ('ok' in result) throw new Error('expected successful result')
    expect(result.videos[0].url).toContain('props.mp4')
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

    if ('ok' in result) throw new Error('expected successful result')
    expect(result.videos[0].url).toContain('scope.mp4')
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

    if ('ok' in result) throw new Error('expected successful result')
    expect(result.videos[0].url).toContain('pageprops.mp4')
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

    if ('ok' in result) throw new Error('expected successful normalization')
    expect(result.videos).toEqual([])
    expect(result.description).toContain('超过当前下载上限 480 秒')
  })

  it('keeps SSR snapshots without downloads inside the configured duration limit', async () => {
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

  it('resolves live rooms into title, cover and viewer count without pulling the stream', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (!url.includes('/webcast/room/web/enter/')) throw new Error(`unexpected url: ${url}`)
      return new Response(JSON.stringify({
        data: {
          data: [{
            title: '深夜聊天',
            status: 2,
            user_count_str: '1.2万',
            cover: { url_list: ['https://p3.douyinpic.com/live-cover.jpg', 'https://p3.douyinpic.com/live-cover-large.jpg'] },
            owner: { nickname: '主播昵称' }
          }]
        }
      }), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await resolveDouyin('https://live.douyin.com/123456', '', [])

    if ('ok' in result) throw new Error('expected successful result')
    expect(result).toMatchObject({
      platform: 'douyin',
      displayName: '抖音直播',
      title: '深夜聊天',
      author: '主播昵称',
      videos: [],
      images: ['https://p3.douyinpic.com/live-cover-large.jpg']
    })
    expect(result.description).toContain('在线人数：1.2万')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('resolves webcast reflow live links through the client room endpoint', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (!url.includes('/webcast/room/reflow/info/')) throw new Error(`unexpected url: ${url}`)
      return new Response(JSON.stringify({
        data: {
          room: {
            title: '连麦现场',
            user_count: 321,
            cover: { url_list: ['https://p3.douyinpic.com/reflow.jpg'] },
            owner: { nickname: '主播B' }
          }
        }
      }), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await resolveDouyin('https://webcast.amemv.com/douyin/webcast/reflow/7654321', '', [])

    if ('ok' in result) throw new Error('expected successful result')
    expect(result.title).toBe('连麦现场')
    expect(result.images).toEqual(['https://p3.douyinpic.com/reflow.jpg'])
    expect(result.description).toContain('在线人数：321')
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('room_id=7654321'), expect.anything())
  })

  it('reports a readable failure when the live room payload is empty', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ data: {} }), { status: 200 })))

    const result = await resolveDouyin('https://live.douyin.com/123456', '', [])

    expect(result).toMatchObject({ platform: 'douyin', ok: false })
    if (!('ok' in result)) throw new Error('expected failure')
    expect(result.reason).toContain('直播间信息')
  })
})
