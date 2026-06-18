import { afterEach, describe, expect, it, vi } from 'vitest'

import { extractWeiboId, normalizeWeiboStatus, normalizeWeiboComments, resolveWeibo } from '@/resolvers/weibo'

describe('weibo enhanced normalization', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('normalizes media and comments', () => {
    const comments = normalizeWeiboComments({
      data: {
        data: [
          { user: { screen_name: '路人' }, text: '<span>好看</span>' }
        ]
      }
    })

    const result = normalizeWeiboStatus('https://weibo.com/1/abc', {
      text: '<p>正文</p>',
      bid: 'abc',
      user: { id: '1', screen_name: 'Hira' },
      pics: [{ large: { url: 'https://img/a.jpg' } }],
      page_info: { media_info: { stream_url_hd: 'https://video/hd.mp4', stream_url: 'https://video/sd.mp4' } }
    }, comments)

    expect(result.description).toContain('正文')
    expect(result.description).toContain('热门评论')
    expect(result.videos).toEqual(['https://video/hd.mp4'])
    expect(result.images).toEqual(['https://img/a.jpg'])
    expect(result.extras?.contentBlocks).toEqual([
      { type: 'text', text: '正文' },
      { type: 'image', url: 'https://img/a.jpg' }
    ])
    expect(result.extras?.commentBlocks).toEqual([
      { author: '路人', text: '好看', images: [] }
    ])
  })

  it('uses long text, author metadata, video cover, and post metadata in rich extras', () => {
    const result = normalizeWeiboStatus('https://weibo.com/1/abc', {
      text: '<p>短正文</p>',
      longTextContent: '<p>这是完整长文正文</p>',
      bid: 'abc',
      created_at: 'Wed Jun 17 12:00:00 +0800 2026',
      region_name: '发布于 上海',
      source: '微博网页版',
      user: {
        id: '1',
        screen_name: 'Hira',
        avatar_hd: 'https://tvax1.sinaimg.cn/avatar.jpg'
      },
      page_info: {
        page_pic: { url: 'https://wx1.sinaimg.cn/large/video-cover.jpg' },
        media_info: { mp4_hd_url: 'https://video/weibo.mp4' }
      }
    })

    expect(result).toMatchObject({
      title: '这是完整长文正文',
      description: expect.stringContaining('这是完整长文正文'),
      images: ['https://wx1.sinaimg.cn/large/video-cover.jpg'],
      videos: ['https://video/weibo.mp4'],
      extras: {
        coverUrl: 'https://wx1.sinaimg.cn/large/video-cover.jpg',
        authorAvatar: 'https://tvax1.sinaimg.cn/avatar.jpg',
        location: '发布于 上海',
        createdAt: 'Wed Jun 17 12:00:00 +0800 2026',
        contentBlocks: [
          { type: 'text', text: '这是完整长文正文' },
          { type: 'image', url: 'https://wx1.sinaimg.cn/large/video-cover.jpg' }
        ]
      }
    })
  })

  it('keeps retweeted weibo content and media in ordered rich blocks', () => {
    const result = normalizeWeiboStatus('https://weibo.com/1/abc', {
      text: '<p>转发理由</p>',
      bid: 'abc',
      user: { id: '1', screen_name: '转发者' },
      retweeted_status: {
        text: '<p>原微博正文</p>',
        user: { id: '2', screen_name: '原作者' },
        pics: [{ large: { url: 'https://wx1.sinaimg.cn/large/retweeted.jpg' } }],
        page_info: {
          page_pic: { url: 'https://wx1.sinaimg.cn/large/retweeted-cover.jpg' },
          media_info: { stream_url_hd: 'https://video/retweeted.mp4' }
        }
      }
    })

    expect(result.description).toContain('转发理由')
    expect(result.description).toContain('转发 @原作者')
    expect(result.description).toContain('原微博正文')
    expect(result.images).toEqual([
      'https://wx1.sinaimg.cn/large/retweeted.jpg',
      'https://wx1.sinaimg.cn/large/retweeted-cover.jpg'
    ])
    expect(result.videos).toEqual(['https://video/retweeted.mp4'])
    expect(result.extras?.tags).toEqual(['转发'])
    expect(result.extras?.contentBlocks).toEqual([
      { type: 'text', text: '转发理由' },
      { type: 'text', text: '转发 @原作者：原微博正文' },
      { type: 'image', url: 'https://wx1.sinaimg.cn/large/retweeted.jpg' },
      { type: 'image', url: 'https://wx1.sinaimg.cn/large/retweeted-cover.jpg' }
    ])
  })

  it('extracts weibo ids from mobile, tv, and desktop links', () => {
    expect(extractWeiboId('https://m.weibo.cn/detail/501234567890')).toBe('501234567890')
    expect(extractWeiboId('https://m.weibo.cn/status/501234567890')).toBe('501234567890')
    expect(extractWeiboId('https://weibo.com/tv/show/1034:abc?mid=501234567890')).toBeDefined()
    expect(extractWeiboId('https://weibo.com/123456/AbCdEf')).toBe('AbCdEf')
  })

  it('prefers embedded status data from the mobile detail page like R plugin', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.startsWith('https://m.weibo.cn/detail/')) {
        return new Response(`
          <script>
            $render_data = [{
              "status": {
                "text": "<p>来自页面的正文</p>",
                "bid": "R47877p8L",
                "source": "微博网页版",
                "region_name": "发布于 上海",
                "user": { "id": "1886633831", "screen_name": "Hira" },
                "pics": [{ "large": { "url": "https://wx1.sinaimg.cn/large/a.jpg" } }],
                "page_info": { "urls": { "mp4_720p_mp4": "https://video.weibo/720.mp4" } }
              }
            }][0]
          </script>
        `, { status: 200 })
      }
      if (url.startsWith('https://m.weibo.cn/comments/hotflow')) {
        return new Response(JSON.stringify({
          data: {
            data: [
              { user: { screen_name: '路人' }, text: '<span>评论</span>' }
            ]
          }
        }), { status: 200 })
      }
      throw new Error(`unexpected url: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await resolveWeibo('https://weibo.com/1886633831/R47877p8L')

    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://m.weibo.cn/detail/R47877p8L')
    expect(fetchMock).not.toHaveBeenCalledWith(expect.stringContaining('/statuses/show'), expect.anything())
    expect(result).toMatchObject({
      platform: 'weibo',
      displayName: '微博',
      title: '来自页面的正文',
      author: 'Hira',
      pageUrl: 'https://weibo.com/1886633831/R47877p8L',
      images: ['https://wx1.sinaimg.cn/large/a.jpg'],
      videos: ['https://video.weibo/720.mp4']
    })
    expect('ok' in result).toBe(false)
    if ('ok' in result) throw new Error('expected successful result')
    expect(result.extras?.commentBlocks).toEqual([
      { author: '路人', text: '评论', images: [] }
    ])
  })

  it('fetches extended long text before normalizing long weibo posts', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.startsWith('https://m.weibo.cn/detail/')) {
        return new Response('<html></html>', { status: 200 })
      }
      if (url.startsWith('https://m.weibo.cn/statuses/show')) {
        return new Response(JSON.stringify({
          data: {
            id: '501234567890',
            bid: 'R47877p8L',
            text: '<p>被折叠的短正文</p>',
            isLongText: true,
            user: { id: '1886633831', screen_name: 'Hira' }
          }
        }), { status: 200 })
      }
      if (url.startsWith('https://m.weibo.cn/statuses/extend')) {
        return new Response(JSON.stringify({
          data: {
            longTextContent: '<p>接口返回的完整长文</p>'
          }
        }), { status: 200 })
      }
      if (url.startsWith('https://m.weibo.cn/comments/hotflow')) {
        return new Response(JSON.stringify({ data: { data: [] } }), { status: 200 })
      }
      throw new Error(`unexpected url: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await resolveWeibo('https://weibo.com/1886633831/R47877p8L')

    expect(fetchMock).toHaveBeenCalledWith(
      'https://m.weibo.cn/statuses/extend?id=501234567890',
      expect.objectContaining({
        headers: expect.objectContaining({ 'X-Requested-With': 'XMLHttpRequest' })
      })
    )
    expect(fetchMock).toHaveBeenCalledWith(
      'https://m.weibo.cn/comments/hotflow?id=501234567890&mid=501234567890&max_id_type=0',
      expect.objectContaining({
        headers: expect.objectContaining({ 'X-Requested-With': 'XMLHttpRequest' })
      })
    )
    expect(result).toMatchObject({
      title: '接口返回的完整长文',
      description: '接口返回的完整长文'
    })
    expect('ok' in result).toBe(false)
    if ('ok' in result) throw new Error('expected successful result')
    expect(result.extras?.contentBlocks).toEqual([
      { type: 'text', text: '接口返回的完整长文' }
    ])
  })
})
