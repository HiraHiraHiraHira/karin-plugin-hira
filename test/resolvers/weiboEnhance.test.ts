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
})
