import { describe, expect, it } from 'vitest'

import { extractWeiboId, normalizeWeiboStatus, normalizeWeiboComments } from '@/resolvers/weibo'

describe('weibo enhanced normalization', () => {
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
  })

  it('extracts weibo ids from mobile, tv, and desktop links', () => {
    expect(extractWeiboId('https://m.weibo.cn/detail/501234567890')).toBe('501234567890')
    expect(extractWeiboId('https://m.weibo.cn/status/501234567890')).toBe('501234567890')
    expect(extractWeiboId('https://weibo.com/tv/show/1034:abc?mid=501234567890')).toBeDefined()
    expect(extractWeiboId('https://weibo.com/123456/AbCdEf')).toBe('AbCdEf')
  })
})
