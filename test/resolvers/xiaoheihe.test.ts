import { describe, expect, it } from 'vitest'

import {
  buildXiaoheiheApiRequest,
  extractXiaoheiheTarget,
  normalizeXiaoheihePost,
  optimizeXiaoheiheImageUrl
} from '@/resolvers/xiaoheihe'

describe('extractXiaoheiheTarget', () => {
  it('extracts bbs ids from app and web share links', () => {
    expect(extractXiaoheiheTarget('https://www.xiaoheihe.cn/app/bbs/link/abc123')).toEqual({
      type: 'bbs',
      id: 'abc123'
    })
    expect(extractXiaoheiheTarget('https://api.xiaoheihe.cn/bbs/app/api/web/share?link_id=xyz789')).toEqual({
      type: 'bbs',
      id: 'xyz789'
    })
  })

  it('extracts game ids from pc, console, and mobile links', () => {
    expect(extractXiaoheiheTarget('https://www.xiaoheihe.cn/app/topic/game/pc/730')).toEqual({
      type: 'pc',
      id: '730'
    })
    expect(extractXiaoheiheTarget('https://www.xiaoheihe.cn/game/share_game_detail?appid=100&game_type=console')).toEqual({
      type: 'console',
      id: '100'
    })
    expect(extractXiaoheiheTarget('https://www.xiaoheihe.cn/game/share_game_detail?appid=200&game_type=mobile')).toEqual({
      type: 'mobile',
      id: '200'
    })
  })
})

describe('buildXiaoheiheApiRequest', () => {
  it('builds deterministic bbs API request params when time and nonce are supplied', () => {
    const request = buildXiaoheiheApiRequest('bbs', 'abc123', {
      timestamp: 1700000000,
      nonce: 'ABCDEF'
    })

    expect(request.url).toBe('https://api.xiaoheihe.cn/bbs/app/link/tree')
    expect(request.params).toMatchObject({
      link_id: 'abc123',
      limit: 20,
      os_type: 'web',
      version: '999.0.4',
      _time: 1700000000,
      nonce: 'ABCDEF',
      web_version: '2.5',
      x_client_type: 'web',
      x_app: 'heybox_website',
      x_os_type: 'Android'
    })
    expect(request.params.hkey).toMatch(/^[A-Z0-9]{7}$/)
  })
})

describe('normalizeXiaoheihePost', () => {
  it('normalizes title, author, text, media, tags, and comments', () => {
    const result = normalizeXiaoheihePost('https://www.xiaoheihe.cn/app/bbs/link/abc123', {
      status: 'ok',
      result: {
        link: {
          title: '好玩的帖子',
          description: '简介',
          thumb: 'https://img.example.test/cover.jpg?x=1',
          has_video: 1,
          video_url: 'https://video.example.test/a.mp4',
          user: { username: 'Hira' },
          hashtags: [{ name: '游戏' }, { name: '音乐' }],
          text: JSON.stringify([
            { type: 'text', text: '第一段' },
            { type: 'img', url: 'https://img.example.test/a.jpg?size=small' },
            { type: 'html', text: '<p>第二段<br/>带链接</p><img data-original="https://img.example.test/b.jpg?x=2"/>' }
          ])
        },
        comments: [
          {
            comment: [
              {
                floor_num: 1,
                create_at: 1700000000,
                ip_location: '上海',
                text: '<p>评论内容</p>',
                user: { username: '路人' },
                imgs: [{ url: 'https://img.example.test/c.jpg?x=3' }]
              }
            ]
          }
        ]
      }
    })

    expect(result).toMatchObject({
      platform: 'xiaoheihe',
      displayName: '小黑盒帖子',
      title: '好玩的帖子',
      author: 'Hira',
      pageUrl: 'https://www.xiaoheihe.cn/app/bbs/link/abc123',
      videos: ['https://video.example.test/a.mp4']
    })
    expect('ok' in result).toBe(false)
    if ('ok' in result) throw new Error('expected successful post result')
    expect(result.description).toContain('简介')
    expect(result.description).toContain('#游戏 #音乐')
    expect(result.description).toContain('第一段')
    expect(result.description).toContain('第二段')
    expect(result.description).toContain('热门评论')
    expect(result.images).toEqual([
      'https://img.example.test/cover.jpg?x=1\\',
      'https://img.example.test/a.jpg?size=small\\',
      'https://img.example.test/b.jpg?x=2\\',
      'https://img.example.test/c.jpg?x=3\\'
    ])
  })

  it('returns a failure for invalid API responses', () => {
    expect(normalizeXiaoheihePost('https://xiaoheihe.cn/app/bbs/link/a', { status: 'fail' })).toEqual({
      platform: 'xiaoheihe',
      displayName: '小黑盒',
      ok: false,
      reason: '小黑盒 API 返回异常'
    })
  })
})

describe('optimizeXiaoheiheImageUrl', () => {
  it('adds a trailing backslash only when query params exist', () => {
    expect(optimizeXiaoheiheImageUrl('https://img.example.test/a.jpg?x=1')).toBe('https://img.example.test/a.jpg?x=1\\')
    expect(optimizeXiaoheiheImageUrl('https://img.example.test/a.jpg')).toBe('https://img.example.test/a.jpg')
  })
})
