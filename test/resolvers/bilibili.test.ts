import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  calculateBilibiliFnval,
  classifyBilibiliUrl,
  createBilibiliPlayUrl,
  extractBilibiliAid,
  extractBilibiliPage,
  extractBvid,
  isBilibiliShortUrl,
  normalizeBilibiliVideoInfo,
  resolveBilibili,
  selectBestBilibiliStream,
  selectBilibiliCdnUrl
} from '@/resolvers/bilibili'
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

const viewPayload = (overrides: Record<string, unknown> = {}) => ({
  code: 0,
  data: {
    aid: 123,
    bvid: 'BV14A31eZEH8',
    cid: 456,
    title: '视频标题',
    pic: 'https://i0.hdslb.com/cover.jpg',
    owner: { name: 'UP主' },
    duration: 120,
    ...overrides
  }
})

describe('bilibili resolver helpers', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it('extracts bvid and av ids from ordinary video links', () => {
    expect(extractBvid('https://www.bilibili.com/video/BV14A31eZEH8?p=2')).toBe('BV14A31eZEH8')
    expect(extractBvid('https://m.bilibili.com/video/BV1xx411c7mD')).toBe('BV1xx411c7mD')
    expect(extractBilibiliAid('https://www.bilibili.com/video/av170001')).toBe('170001')
    expect(extractBilibiliAid('https://www.bilibili.com/video/BV14A31eZEH8')).toBeUndefined()
  })

  it('parses multi-P page numbers and short-link hosts', () => {
    expect(extractBilibiliPage('https://www.bilibili.com/video/BV14A31eZEH8?p=2')).toBe(2)
    expect(extractBilibiliPage('https://www.bilibili.com/video/BV14A31eZEH8')).toBe(1)
    expect(extractBilibiliPage('https://www.bilibili.com/video/BV14A31eZEH8?p=abc')).toBe(1)
    expect(isBilibiliShortUrl('https://b23.tv/abc123')).toBe(true)
    expect(isBilibiliShortUrl('https://bili2233.cn/abc123')).toBe(true)
    expect(isBilibiliShortUrl('https://www.bilibili.com/video/BV14A31eZEH8')).toBe(false)
  })

  it('classifies live rooms, bangumi, articles, dynamics and plain videos', () => {
    expect(classifyBilibiliUrl('https://live.bilibili.com/12345')).toEqual({ kind: 'live', roomId: '12345' })
    expect(classifyBilibiliUrl('https://www.bilibili.com/bangumi/play/ep123')).toEqual({ kind: 'bangumi', epId: '123' })
    expect(classifyBilibiliUrl('https://www.bilibili.com/bangumi/play/ss456')).toEqual({ kind: 'bangumi', seasonId: '456' })
    expect(classifyBilibiliUrl('https://www.bilibili.com/read/cv789')).toEqual({ kind: 'article', cvid: '789' })
    expect(classifyBilibiliUrl('https://t.bilibili.com/998877')).toEqual({ kind: 'dynamic', dynamicId: '998877' })
    expect(classifyBilibiliUrl('https://www.bilibili.com/opus/998877')).toEqual({ kind: 'dynamic', dynamicId: '998877' })
    expect(classifyBilibiliUrl('https://www.bilibili.com/video/BV14A31eZEH8?p=2')).toEqual({
      kind: 'video',
      bvid: 'BV14A31eZEH8',
      page: 2
    })
    expect(classifyBilibiliUrl('https://www.bilibili.com/video/av170001')).toEqual({
      kind: 'video',
      aid: '170001',
      page: 1
    })
  })

  it('normalizes video info payloads with the full stat line', () => {
    const result = normalizeBilibiliVideoInfo('https://www.bilibili.com/video/BV14A31eZEH8', {
      code: 0,
      data: {
        bvid: 'BV14A31eZEH8',
        title: '视频标题',
        desc: '简介',
        pic: 'https://i0.hdslb.com/cover.jpg',
        owner: { name: 'UP主' },
        stat: { view: 100, like: 20, reply: 3, coin: 4, favorite: 5, share: 6, danmaku: 7 }
      }
    })

    expect(result).toMatchObject({
      platform: 'bilibili',
      displayName: '哔哩哔哩',
      title: '视频标题',
      author: 'UP主',
      pageUrl: 'https://www.bilibili.com/video/BV14A31eZEH8',
      images: ['https://i0.hdslb.com/cover.jpg'],
      videos: [],
      extras: {
        coverUrl: 'https://i0.hdslb.com/cover.jpg',
        tags: [],
        contentBlocks: [
          { type: 'text', text: '简介' },
          { type: 'image', url: 'https://i0.hdslb.com/cover.jpg' }
        ]
      }
    })
    expect('ok' in result).toBe(false)
    if ('ok' in result) throw new Error('expected successful result')
    expect(result.description).toContain('简介')
    for (const fragment of ['播放：100', '点赞：20', '硬币：4', '收藏：5', '分享：6', '弹幕：7', '评论：3']) {
      expect(result.description).toContain(fragment)
    }
  })

  it('keeps the av page url when the API response has no bvid', () => {
    const result = normalizeBilibiliVideoInfo('https://www.bilibili.com/video/av170001', {
      code: 0,
      data: { aid: 170001, title: '旧稿件', cid: 1 }
    })
    if ('ok' in result) throw new Error('expected successful result')
    expect(result.pageUrl).toBe('https://www.bilibili.com/video/av170001')
  })

  it('normalizes Bilibili owner avatar, category tag, and publish time into rich extras', () => {
    const result = normalizeBilibiliVideoInfo('https://www.bilibili.com/video/BV14A31eZEH8', {
      code: 0,
      data: {
        bvid: 'BV14A31eZEH8',
        title: '视频标题',
        desc: '更完整的简介',
        pic: 'https://i0.hdslb.com/cover.jpg',
        owner: { name: 'UP主', face: 'https://i0.hdslb.com/avatar.jpg' },
        tname: '单机游戏',
        pubdate: 1700000000
      }
    })

    if ('ok' in result) throw new Error('expected successful result')
    expect(result.extras).toEqual({
      coverUrl: 'https://i0.hdslb.com/cover.jpg',
      authorAvatar: 'https://i0.hdslb.com/avatar.jpg',
      tags: ['单机游戏'],
      contentBlocks: [
        { type: 'text', text: '更完整的简介' },
        { type: 'image', url: 'https://i0.hdslb.com/cover.jpg' }
      ],
      createdAt: 1700000000
    })
  })

  it('returns a failure for missing API data', () => {
    expect(normalizeBilibiliVideoInfo('https://www.bilibili.com/video/BV14A31eZEH8', {
      code: -404,
      message: '啥都木有'
    })).toMatchObject({ platform: 'bilibili', ok: false })
  })

  it('requests AV1 and per-quality DASH flags in the playurl request', () => {
    const standard = new URL(createBilibiliPlayUrl('BV14A31eZEH8', 456, 80))
    expect(standard.searchParams.get('bvid')).toBe('BV14A31eZEH8')
    expect(standard.searchParams.get('cid')).toBe('456')
    expect(standard.searchParams.get('qn')).toBe('80')
    // 16 = DASH, 2048 = AV1：缺了 2048 时接口不会下发 AV1 流，codec=av1 永远选不中
    expect(standard.searchParams.get('fnval')).toBe(String(16 | 2048))
    expect(standard.searchParams.get('fourk')).toBe('0')

    expect(calculateBilibiliFnval(120)).toEqual({ fnval: 16 | 2048 | 128, fourk: 1 })
    expect(calculateBilibiliFnval(125)).toEqual({ fnval: 16 | 2048 | 64, fourk: 1 })
    expect(calculateBilibiliFnval(126)).toEqual({ fnval: 16 | 2048 | 512, fourk: 1 })
    expect(calculateBilibiliFnval(127)).toEqual({ fnval: 16 | 2048 | 1024, fourk: 1 })

    const ultraHd = new URL(createBilibiliPlayUrl('BV14A31eZEH8', 456, 120))
    expect(ultraHd.searchParams.get('fourk')).toBe('1')
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
    // auto 与 R 插件一致：AV1 > HEVC > AVC
    expect(selectBestBilibiliStream(streams, 'auto')?.url).toBe('https://video.example.test/av1.m4s')
  })

  it('prefers the lower bitrate stream when quality and codec are equivalent', () => {
    const streams = [
      { id: 64, codecs: 'avc1.640028', baseUrl: 'https://video.example.test/avc-large.m4s', bandwidth: 18000000 },
      { id: 64, codecs: 'avc1.640028', baseUrl: 'https://video.example.test/avc-small.m4s', bandwidth: 2200000 }
    ]

    expect(selectBestBilibiliStream(streams, 'avc')?.url).toBe('https://video.example.test/avc-small.m4s')
  })

  it('drops streams above the configured quality ceiling', () => {
    const streams = [
      { id: 120, codecs: 'avc1.640028', baseUrl: 'https://video.example.test/4k.m4s' },
      { id: 64, codecs: 'avc1.640028', baseUrl: 'https://video.example.test/720p.m4s' }
    ]

    expect(selectBestBilibiliStream(streams, 'avc', 80)?.url).toBe('https://video.example.test/720p.m4s')
  })

  it('avoids mcdn slow nodes by switching to a backup or mirror host', () => {
    expect(selectBilibiliCdnUrl(
      'https://xy1x2x3x4x5.mcdn.bilivideo.cn:4483/video.m4s',
      ['https://cn-jsnt-ct-01-07.bilivideo.com/video.m4s']
    )).toBe('https://cn-jsnt-ct-01-07.bilivideo.com/video.m4s')

    expect(selectBilibiliCdnUrl('https://xy1x2x3x4x5.mcdn.bilivideo.cn:4483/video.m4s'))
      .toBe('https://upos-sz-mirrorcoso1.bilivideo.com:4483/video.m4s')

    // 已经是快速 CDN 时原样保留
    expect(selectBilibiliCdnUrl('https://upos-sz-mirrorcos.bilivideo.com/video.m4s'))
      .toBe('https://upos-sz-mirrorcos.bilivideo.com/video.m4s')
  })

  it('returns progressive stream urls without downloading them', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('/x/web-interface/view')) return new Response(JSON.stringify(viewPayload()), { status: 200 })
      if (url.includes('/x/player/playurl')) {
        return new Response(JSON.stringify({
          code: 0,
          data: { durl: [{ url: 'https://video.example.test/bilibili.mp4' }] }
        }), { status: 200 })
      }
      throw new Error(`unexpected url: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await resolveBilibili('https://www.bilibili.com/video/BV14A31eZEH8')

    if ('ok' in result) throw new Error('expected successful result')
    expect(result.videos).toEqual([{ url: 'https://video.example.test/bilibili.mp4' }])
    expect(runtimeMocks.downloadFile).not.toHaveBeenCalled()
    expect(runtimeMocks.runFfmpeg).not.toHaveBeenCalled()
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('cid=456'),
      expect.objectContaining({ headers: expect.objectContaining({ Referer: 'https://www.bilibili.com/video/BV14A31eZEH8' }) })
    )
  })

  it('registers DASH video and audio streams for the sender to merge', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('/x/web-interface/view')) return new Response(JSON.stringify(viewPayload()), { status: 200 })
      if (url.includes('/x/player/playurl')) {
        return new Response(JSON.stringify({
          code: 0,
          data: {
            dash: {
              video: [
                { id: 32, baseUrl: 'https://video.example.test/low.m4s', bandwidth: 1000 },
                { id: 112, codecs: 'avc1.640028', baseUrl: 'https://video.example.test/high.m4s', bandwidth: 2000 }
              ],
              audio: [{ id: 30280, baseUrl: 'https://audio.example.test/audio.m4s' }]
            }
          }
        }), { status: 200 })
      }
      throw new Error(`unexpected url: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await resolveBilibili('https://www.bilibili.com/video/BV14A31eZEH8')

    if ('ok' in result) throw new Error('expected successful result')
    expect(result.videos).toEqual([{
      url: 'https://video.example.test/high.m4s',
      audioUrl: 'https://audio.example.test/audio.m4s'
    }])
    expect(runtimeMocks.downloadFile).not.toHaveBeenCalled()
    expect(runtimeMocks.runFfmpeg).not.toHaveBeenCalled()
  })

  it('marks charging-only preview streams instead of pretending they are complete', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('/x/web-interface/view')) return new Response(JSON.stringify(viewPayload()), { status: 200 })
      if (url.includes('/x/player/playurl')) {
        return new Response(JSON.stringify({
          code: 0,
          data: {
            is_preview: 1,
            durl: [{ url: 'https://video.example.test/preview.mp4' }]
          }
        }), { status: 200 })
      }
      throw new Error(`unexpected url: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await resolveBilibili('https://www.bilibili.com/video/BV14A31eZEH8')

    if ('ok' in result) throw new Error('expected successful result')
    expect(result.videos).toEqual([{ url: 'https://video.example.test/preview.mp4' }])
    expect(result.description).toContain('试看片段')
  })

  it('reports permission-limited videos instead of silently sending nothing', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('/x/web-interface/view')) return new Response(JSON.stringify(viewPayload()), { status: 200 })
      if (url.includes('/x/player/playurl')) {
        return new Response(JSON.stringify({ code: -10403, message: '大会员专享限制' }), { status: 200 })
      }
      throw new Error(`unexpected url: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await resolveBilibili('https://www.bilibili.com/video/BV14A31eZEH8')

    if ('ok' in result) throw new Error('expected successful result')
    expect(result.videos).toEqual([])
    expect(result.description).toContain('没有播放权限')
    expect(runtimeMocks.downloadFile).not.toHaveBeenCalled()
  })

  it('degrades to cover and source link when the playurl request fails', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('/x/web-interface/view')) return new Response(JSON.stringify(viewPayload()), { status: 200 })
      throw new Error('playurl unavailable')
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await resolveBilibili('https://www.bilibili.com/video/BV14A31eZEH8')

    if ('ok' in result) throw new Error('expected successful result')
    expect(result.videos).toEqual([])
    expect(result.description).toContain('视频资源暂不可用，已降级为封面和原链接')
  })

  it('resolves av links through the aid query and reports the canonical bvid page', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('/x/web-interface/view')) {
        expect(url).toContain('aid=170001')
        return new Response(JSON.stringify(viewPayload()), { status: 200 })
      }
      if (url.includes('/x/player/playurl')) {
        expect(url).toContain('bvid=BV14A31eZEH8')
        return new Response(JSON.stringify({ code: 0, data: { durl: [{ url: 'https://video.example.test/av.mp4' }] } }), { status: 200 })
      }
      throw new Error(`unexpected url: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await resolveBilibili('https://www.bilibili.com/video/av170001')

    if ('ok' in result) throw new Error('expected successful result')
    expect(result.pageUrl).toBe('https://www.bilibili.com/video/BV14A31eZEH8')
    expect(result.videos).toEqual([{ url: 'https://video.example.test/av.mp4' }])
  })

  it('resolves multi-P videos with the cid of the requested page', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('/x/web-interface/view')) {
        return new Response(JSON.stringify(viewPayload({
          pages: [
            { cid: 111, page: 1, part: 'P1', duration: 60 },
            { cid: 222, page: 2, part: 'P2', duration: 90 }
          ]
        })), { status: 200 })
      }
      if (url.includes('/x/player/playurl')) {
        return new Response(JSON.stringify({ code: 0, data: { durl: [{ url: 'https://video.example.test/p2.mp4' }] } }), { status: 200 })
      }
      throw new Error(`unexpected url: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    await resolveBilibili('https://www.bilibili.com/video/BV14A31eZEH8?p=2')

    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('cid=222'), expect.anything())
  })

  it('returns live room metadata without pulling the stream', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (!url.includes('/room/v1/Room/get_info')) throw new Error(`unexpected url: ${url}`)
      return new Response(JSON.stringify({
        code: 0,
        data: {
          title: '今晚打游戏',
          online: 4321,
          user_cover: 'https://i0.hdslb.com/live-cover.jpg',
          keyframe: 'https://i0.hdslb.com/live-keyframe.jpg',
          parent_area_name: '虚拟主播',
          area_name: '虚拟日常',
          live_time: '2026-10-30 20:00:00',
          tags: '游戏,闲聊'
        }
      }), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await resolveBilibili('https://live.bilibili.com/123')

    if ('ok' in result) throw new Error('expected successful result')
    expect(result).toMatchObject({
      platform: 'bilibili',
      displayName: '哔哩哔哩直播',
      title: '今晚打游戏',
      videos: [],
      images: ['https://i0.hdslb.com/live-cover.jpg', 'https://i0.hdslb.com/live-keyframe.jpg']
    })
    expect(result.description).toContain('在线人数：4321')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('resolves bangumi ep links into metadata plus a lazy DASH stream', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('/pgc/view/web/season')) {
        return new Response(JSON.stringify({
          code: 0,
          result: {
            title: '测试番剧',
            cover: 'https://i0.hdslb.com/bangumi.jpg',
            type_name: '番剧',
            rating: { score: 9.1, count: 1000 },
            episodes: [{ ep_id: 123, cid: 777, title: '第1话', long_title: '起点', duration: 60000 }]
          }
        }), { status: 200 })
      }
      if (url.includes('/pgc/player/web/playurl')) {
        return new Response(JSON.stringify({
          code: 0,
          result: {
            dash: {
              video: [{ id: 112, codecs: 'avc1.640028', baseUrl: 'https://video.example.test/bangumi.m4s' }],
              audio: [{ id: 30280, baseUrl: 'https://audio.example.test/bangumi.m4s' }]
            }
          }
        }), { status: 200 })
      }
      throw new Error(`unexpected url: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await resolveBilibili('https://www.bilibili.com/bangumi/play/ep123')

    if ('ok' in result) throw new Error('expected successful result')
    expect(result.displayName).toBe('哔哩哔哩番剧')
    expect(result.title).toContain('测试番剧')
    expect(result.videos).toEqual([{
      url: 'https://video.example.test/bangumi.m4s',
      audioUrl: 'https://audio.example.test/bangumi.m4s'
    }])
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('ep_id=123'), expect.anything())
  })

  it('resolves ss links through the season section before the episode', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('/pgc/web/season/section')) {
        return new Response(JSON.stringify({
          code: 0,
          result: { main_section: { episodes: [{ ep_id: 456 }] } }
        }), { status: 200 })
      }
      if (url.includes('/pgc/view/web/season')) {
        return new Response(JSON.stringify({
          code: 0,
          result: { title: '测试番剧', episodes: [{ ep_id: 456, cid: 888, title: '第2话', duration: 60000 }] }
        }), { status: 200 })
      }
      if (url.includes('/pgc/player/web/playurl')) {
        return new Response(JSON.stringify({ code: 0, result: { durl: [{ url: 'https://video.example.test/ss.mp4' }] } }), { status: 200 })
      }
      throw new Error(`unexpected url: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await resolveBilibili('https://www.bilibili.com/bangumi/play/ss456')

    if ('ok' in result) throw new Error('expected successful result')
    expect(result.videos).toEqual([{ url: 'https://video.example.test/ss.mp4' }])
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('ep_id=456'), expect.anything())
  })

  it('resolves read/cv articles into images', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (!url.includes('/x/article/viewinfo')) throw new Error(`unexpected url: ${url}`)
      return new Response(JSON.stringify({
        code: 0,
        data: {
          title: '专栏标题',
          author_name: '专栏作者',
          banner_url: 'https://i0.hdslb.com/banner.jpg',
          origin_image_urls: ['https://i0.hdslb.com/a.jpg', 'https://i0.hdslb.com/b.jpg']
        }
      }), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await resolveBilibili('https://www.bilibili.com/read/cv789')

    if ('ok' in result) throw new Error('expected successful result')
    expect(result).toMatchObject({
      displayName: '哔哩哔哩专栏',
      title: '专栏标题',
      author: '专栏作者',
      images: ['https://i0.hdslb.com/a.jpg', 'https://i0.hdslb.com/b.jpg'],
      videos: []
    })
  })

  it('requires a Bilibili cookie before parsing dynamics', async () => {
    const result = await resolveBilibili('https://t.bilibili.com/998877')

    expect(result).toMatchObject({ platform: 'bilibili', ok: false })
    if (!('ok' in result)) throw new Error('expected failure')
    expect(result.reason).toContain('Cookie')
  })

  it('parses dynamic opus modules into ordered text and images', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (!url.includes('/opus/detail')) throw new Error(`unexpected url: ${url}`)
      return new Response(JSON.stringify({
        code: 0,
        data: {
          item: {
            modules: [
              { module_type: 'MODULE_TYPE_TITLE', module_title: { text: '动态标题' } },
              { module_type: 'MODULE_TYPE_AUTHOR', module_author: { name: '动态作者' } },
              { module_type: 'MODULE_TYPE_TOPIC', module_topic: { name: '今日话题' } },
              {
                module_type: 'MODULE_TYPE_CONTENT',
                module_content: {
                  paragraphs: [
                    { para_type: 1, text: { nodes: [{ type: 'TEXT_NODE_TYPE_WORD', word: { words: '正文内容' } }] } },
                    { para_type: 2, pic: { pics: [{ url: 'https://i0.hdslb.com/dynamic.jpg' }] } }
                  ]
                }
              }
            ]
          }
        }
      }), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await resolveBilibili('https://t.bilibili.com/998877', 'SESSDATA=abc')

    if ('ok' in result) throw new Error('expected successful result')
    expect(result.title).toBe('动态标题')
    expect(result.author).toBe('动态作者')
    expect(result.images).toEqual(['https://i0.hdslb.com/dynamic.jpg'])
    expect(result.description).toContain('今日话题')
    expect(result.description).toContain('正文内容')
  })
})
