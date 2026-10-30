import { afterEach, describe, expect, it, vi } from 'vitest'

import { normalizeGeneralApiResponse, normalizeXiguaUrl, resolveGeneral } from '@/resolvers/general'

const pipixiaPage = (data: unknown) => `
  <html><body>
    <script id="RENDER_DATA" type="application/json">${encodeURIComponent(JSON.stringify(data))}</script>
  </body></html>
`

const pipixiaItem = (overrides: Record<string, unknown> = {}) => ({
  ppxItemDetail: {
    item: {
      item_id_str: '7001',
      author: { id_str: '1', name: '作者', avatar: { url_list: [{ url: 'https://img.example.test/avatar.jpg' }] } },
      share: { title: '分享标题' },
      cover: { url_list: [{ url: 'https://img.example.test/cover.jpg' }] },
      video: {
        origin_video_download: { url_list: [{ url: 'https://video.example.test/watermark.mp4' }] },
        video_width: 720,
        video_height: 1280
      },
      stats: { like_count: 12, comment_count: 3, share_count: 4, play_count: 5000 },
      ...overrides
    }
  },
  ppxCellComment: {
    cell_comments: [
      {
        comment_info: {
          item: { video: { video_high: { url_list: [{ url: 'https://video.example.test/clean.mp4' }] } } }
        }
      },
      {
        comment_info: {
          comment_id_str: 'c1',
          text: '好好笑',
          user: { name: '路人' },
          create_time: 1700000000,
          digg_count: 9,
          reply_count: 2
        }
      }
    ]
  }
})

const acfunHtml = (info: unknown) => `
  <html><body><script>window.pageInfo = window.videoInfo = ${JSON.stringify(info)}</script></body></html>
`

describe('normalizeGeneralApiResponse', () => {
  it('normalizes video responses', () => {
    expect(normalizeGeneralApiResponse('皮皮虾', {
      code: 200,
      data: {
        url: 'https://cdn.example.test/a.mp4',
        title: '一个视频',
        cover: 'https://img.example.test/cover.jpg'
      }
    })).toMatchObject({
      platform: 'general',
      displayName: '皮皮虾',
      title: '一个视频',
      videos: [{ url: 'https://cdn.example.test/a.mp4' }],
      images: ['https://img.example.test/cover.jpg'],
      extras: {
        coverUrl: 'https://img.example.test/cover.jpg',
        contentBlocks: [
          { type: 'text', text: '一个视频' },
          { type: 'image', url: 'https://img.example.test/cover.jpg' }
        ]
      }
    })
  })

  it('normalizes image responses from common field names', () => {
    expect(normalizeGeneralApiResponse('即刻', {
      data: {
        images: ['https://img.example.test/a.jpg'],
        desc: '一组图片'
      }
    })).toMatchObject({
      platform: 'general',
      displayName: '即刻',
      title: '一组图片',
      videos: [],
      images: ['https://img.example.test/a.jpg'],
      extras: {
        coverUrl: 'https://img.example.test/a.jpg',
        contentBlocks: [
          { type: 'text', text: '一组图片' },
          { type: 'image', url: 'https://img.example.test/a.jpg' }
        ]
      }
    })
  })

  it('can normalize general API responses as a concrete source platform with page url and author metadata', () => {
    expect(normalizeGeneralApiResponse('快手', {
      data: {
        title: '快手标题',
        desc: '快手正文',
        author: '作者',
        avatar: 'https://img.example.test/avatar.jpg',
        coverUrl: 'https://img.example.test/cover.jpg',
        url: 'https://cdn.example.test/video.mp4',
        images: [
          'https://img.example.test/a.jpg?imageView2/2/w/1080',
          'https://img.example.test/a.jpg?imageView2/2/w/240'
        ]
      }
    }, {
      platform: 'kuaishou',
      pageUrl: 'https://www.kuaishou.com/short-video/3xabc'
    })).toMatchObject({
      platform: 'kuaishou',
      displayName: '快手',
      title: '快手标题',
      description: '快手正文',
      author: '作者',
      pageUrl: 'https://www.kuaishou.com/short-video/3xabc',
      videos: [{ url: 'https://cdn.example.test/video.mp4' }],
      images: [
        'https://img.example.test/cover.jpg',
        'https://img.example.test/a.jpg?imageView2/2/w/1080'
      ],
      extras: {
        coverUrl: 'https://img.example.test/cover.jpg',
        authorAvatar: 'https://img.example.test/avatar.jpg',
        contentBlocks: [
          { type: 'text', text: '快手正文' },
          { type: 'image', url: 'https://img.example.test/cover.jpg' },
          { type: 'image', url: 'https://img.example.test/a.jpg?imageView2/2/w/1080' }
        ]
      }
    })
  })

  it('does not treat music urls as videos', () => {
    expect(normalizeGeneralApiResponse('抖音', {
      data: {
        title: '图文带 BGM',
        url: 'https://p3.douyinpic.com/obj/ies-music/abc.mp3',
        images: ['https://img.example.test/a.jpg']
      }
    })).toMatchObject({
      platform: 'general',
      displayName: '抖音',
      title: '图文带 BGM',
      videos: [],
      images: ['https://img.example.test/a.jpg']
    })
  })

  it('returns failure for empty or failed responses', () => {
    expect(normalizeGeneralApiResponse('西瓜', { code: 404, data: null })).toMatchObject({
      platform: 'general',
      ok: false
    })
    expect(normalizeGeneralApiResponse('西瓜', { data: {} })).toMatchObject({
      platform: 'general',
      ok: false
    })
  })
})

describe('resolveGeneral', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('resolves Pipixia natively with the watermark-free video, stats, and comments', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      expect(url).toBe('https://h5.pipix.com/item/7001')
      return new Response(pipixiaPage(pipixiaItem()), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await resolveGeneral('https://h5.pipix.com/item/7001', ['https://api.example.test/parse?url={url}'])

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(result).toMatchObject({
      platform: 'general',
      displayName: '皮皮虾',
      title: '分享标题',
      author: '作者',
      videos: [{ url: 'https://video.example.test/clean.mp4' }],
      images: ['https://img.example.test/cover.jpg'],
      extras: {
        coverUrl: 'https://img.example.test/cover.jpg',
        authorAvatar: 'https://img.example.test/avatar.jpg'
      }
    })
    expect('ok' in result).toBe(false)
    if ('ok' in result) throw new Error('expected successful result')
    expect(result.description).toContain('📊 数据：👍12 💬3 🔄4 👁️5000')
    expect(result.extras?.contentBlocks).toEqual([
      { type: 'image', url: 'https://img.example.test/cover.jpg' },
      { type: 'text', text: '📊 数据：👍12 💬3 🔄4 👁️5000' }
    ])
    expect(result.extras?.commentBlocks).toEqual([
      {
        author: '路人',
        text: '好好笑',
        images: [],
        likeCount: 9,
        replyCount: 2,
        time: expect.any(String)
      }
    ])
  })

  it('falls back to third-party APIs when the Pipixia page has no render data', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.startsWith('https://h5.pipix.com/item/')) return new Response('<html></html>', { status: 200 })
      expect(url).toContain(encodeURIComponent('https://h5.pipix.com/item/7001'))
      return new Response(JSON.stringify({
        data: {
          title: '接口标题',
          url: 'https://cdn.example.test/fallback.mp4'
        }
      }), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await resolveGeneral('https://h5.pipix.com/item/7001', ['https://api.example.test/parse?url={url}'])

    expect(result).toMatchObject({
      displayName: '皮皮虾',
      title: '接口标题',
      videos: [{ url: 'https://cdn.example.test/fallback.mp4' }]
    })
    expect('ok' in result).toBe(false)
  })

  it('resolves AcFun natively from the ajaxpipe videoInfo payload', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      expect(url).toBe('https://www.acfun.cn/v/ac4621380?quickViewId=videoInfo_new&ajaxpipe=1')
      return new Response(acfunHtml({
        dougaId: '4621380',
        title: '野生视频',
        description: '简介正文',
        user: { name: 'UP主', avatar: 'https://img.example.test/up.jpg' },
        cover: 'https://img.example.test/accover.jpg',
        viewCount: 12000,
        likeCount: 340,
        commentCount: 56,
        createTime: 1700000000000,
        currentVideoInfo: {
          streams: [{ playUrls: [{ url: 'https://cdn.example.test/ac.mp4' }] }],
          ksPlayJson: JSON.stringify({
            adaptationSet: [{ representation: [{ url: 'https://cdn.example.test/ac.m3u8' }] }]
          })
        }
      }), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await resolveGeneral('https://www.acfun.cn/v/ac4621380', ['https://api.example.test/parse?url={url}'])

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(result).toMatchObject({
      platform: 'general',
      displayName: 'AcFun',
      title: '野生视频',
      author: 'UP主',
      pageUrl: 'https://www.acfun.cn/v/ac4621380',
      images: ['https://img.example.test/accover.jpg'],
      videos: [{ url: 'https://cdn.example.test/ac.mp4' }],
      extras: {
        coverUrl: 'https://img.example.test/accover.jpg',
        authorAvatar: 'https://img.example.test/up.jpg',
        createdAt: 1700000000000
      }
    })
    expect('ok' in result).toBe(false)
    if ('ok' in result) throw new Error('expected successful result')
    expect(result.description).toContain('播放 12000')
    expect(result.description).toContain('点赞 340')
  })

  it('falls back to third-party APIs when AcFun returns no videoInfo', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.startsWith('https://www.acfun.cn/')) return new Response('<html></html>', { status: 200 })
      return new Response(JSON.stringify({ data: { url: 'https://cdn.example.test/ac-fallback.mp4' } }), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await resolveGeneral('https://www.acfun.cn/v/ac4621380', ['https://api.example.test/parse?url={url}'])

    expect(result).toMatchObject({
      displayName: 'AcFun',
      videos: [{ url: 'https://cdn.example.test/ac-fallback.mp4' }]
    })
  })

  it('does not register m3u8-only AcFun playlists as videos', async () => {
    const fetchMock = vi.fn(async () => new Response(
      `window.pageInfo = window.videoInfo = ${JSON.stringify({
        dougaId: '4621381',
        title: '仅 HLS 视频',
        currentVideoInfo: {
          ksPlayJson: JSON.stringify({
            adaptationSet: [{ representation: [{ url: 'https://cdn.example.test/only.m3u8' }] }]
          })
        }
      })}`,
      { status: 200 }
    ))
    vi.stubGlobal('fetch', fetchMock)

    const result = await resolveGeneral('https://www.acfun.cn/v/ac4621381', ['https://api.example.test/parse?url={url}'])

    if ('ok' in result) throw new Error('expected successful result')
    expect(result.videos).toEqual([])
    expect(result.description).toContain('m3u8')
  })

  it('normalizes Xigua short links to the canonical video page before calling APIs', async () => {
    await expect(normalizeXiguaUrl(
      'https://v.ixigua.com/ienrQ5bR/',
      async () => 'https://www.ixigua.com/7270448082586698281?logTag=abc'
    )).resolves.toBe('https://www.ixigua.com/7270448082586698281')

    await expect(normalizeXiguaUrl(
      'https://m.ixigua.com/video/7270448082586698281',
      async () => 'https://www.ixigua.com/7270448082586698281'
    )).resolves.toBe('https://www.ixigua.com/7270448082586698281')

    const fetchMock = vi.fn(async (url: string) => {
      expect(url).toContain(encodeURIComponent('https://www.ixigua.com/7270448082586698281'))
      return new Response(JSON.stringify({ data: { url: 'https://cdn.example.test/xigua.mp4' } }), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await resolveGeneral(
      'https://v.ixigua.com/ienrQ5bR/',
      ['https://api.example.test/parse?url={url}'],
      { expandShortUrl: async () => 'https://www.ixigua.com/7270448082586698281?logTag=abc' }
    )

    expect(result).toMatchObject({
      displayName: '西瓜',
      pageUrl: 'https://www.ixigua.com/7270448082586698281',
      videos: [{ url: 'https://cdn.example.test/xigua.mp4' }]
    })
  })
})
