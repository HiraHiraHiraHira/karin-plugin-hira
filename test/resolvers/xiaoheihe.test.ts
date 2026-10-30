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
    expect(request.params.hkey).toBe('V2V1Z67')
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
      videos: [{ url: 'https://video.example.test/a.mp4' }]
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

  it('extracts rich ordered content blocks and comment blocks for follow-up sending', () => {
    const result = normalizeXiaoheihePost('https://www.xiaoheihe.cn/app/bbs/link/abc123', {
      status: 'ok',
      result: {
        link: {
          title: '图文混排帖子',
          description: '摘要',
          thumb: 'https://img.example.test/thumb.jpg?x=0',
          create_at: 1700000010,
          ip_location: '上海',
          user: {
            username: 'Hira',
            avatar: 'https://img.example.test/avatar.jpg?x=9'
          },
          hashtags: [{ name: 'Steam' }, { name: 'AI' }],
          text: JSON.stringify([
            { type: 'text', text: '开头文字' },
            {
              type: 'html',
              text: '<p>正文 <a href="heybox%3A%2F%2F%7B%22protocol_type%22%3A%22openGameDetail%22%2C%22app_id%22%3A%22730%22%2C%22game_type%22%3A%22pc%22%7D">半条命</a></p><img data-original="https://img.example.test/a.jpg?x=1"/><iframe src="//player.example.test/video"></iframe>'
            },
            { type: 'img', url: 'https://img.example.test/b.jpg?x=2' }
          ])
        },
        comments: [
          {
            comment: [
              {
                floor_num: 3,
                create_at: 1700000000,
                ip_location: '上海',
                text: '<p>评论内容</p>',
                user: { username: '路人' },
                replyuser: { username: '作者' },
                imgs: [{ url: 'https://img.example.test/c.jpg?x=3' }]
              }
            ]
          }
        ]
      }
    })

    expect('ok' in result).toBe(false)
    if ('ok' in result) throw new Error('expected successful post result')
    expect(result.extras?.contentBlocks).toEqual([
      { type: 'text', text: '开头文字' },
      { type: 'text', text: '正文 『半条命』 (https://www.xiaoheihe.cn/app/topic/game/pc/730)' },
      { type: 'image', url: 'https://img.example.test/a.jpg?x=1\\' },
      { type: 'text', text: '(https://player.example.test/video)' },
      { type: 'image', url: 'https://img.example.test/b.jpg?x=2\\' }
    ])
    expect(result.extras?.commentBlocks).toEqual([
      {
        author: '路人',
        replyTo: '作者',
        floor: 3,
        location: '上海',
        time: '1700000000',
        text: '评论内容',
        images: ['https://img.example.test/c.jpg?x=3\\']
      }
    ])
    expect(result.extras?.tags).toEqual(['Steam', 'AI'])
    expect(result.extras?.coverUrl).toBe('https://img.example.test/thumb.jpg?x=0\\')
    expect(result.extras?.authorAvatar).toBe('https://img.example.test/avatar.jpg?x=9\\')
    expect(result.extras?.location).toBe('上海')
    expect(result.extras?.createdAt).toBe('1700000010')
  })

  it('returns a failure for invalid API responses', () => {
    expect(normalizeXiaoheihePost('https://xiaoheihe.cn/app/bbs/link/a', { status: 'fail' })).toEqual({
      platform: 'xiaoheihe',
      displayName: '小黑盒',
      ok: false,
      reason: '小黑盒 API 返回异常'
    })
  })

  it('keeps every comment sorted by floor with like and reply counts', () => {
    const commentThreads = [
      {
        comment: [
          {
            floor_num: 3,
            text: '<p>三楼</p>',
            user: { username: '丙' },
            up: 7,
            reply_num: 2
          }
        ]
      },
      {
        comment: [
          {
            floor_num: 1,
            text: '<p>一楼</p>',
            user: { username: '甲' },
            up: 0
          },
          {
            floor_num: 2,
            text: '<p>二楼</p>',
            user: { username: '乙' }
          }
        ]
      }
    ]

    const result = normalizeXiaoheihePost('https://www.xiaoheihe.cn/app/bbs/link/abc123', {
      status: 'ok',
      result: {
        link: { title: '楼层排序', text: JSON.stringify([{ type: 'text', text: '正文' }]) },
        comments: commentThreads
      }
    })

    expect('ok' in result).toBe(false)
    if ('ok' in result) throw new Error('expected successful post result')
    expect(result.extras?.commentBlocks?.map(block => block.floor)).toEqual([1, 2, 3])
    expect(result.extras?.commentBlocks).toMatchObject([
      { author: '甲', text: '一楼', likeCount: 0 },
      { author: '乙', text: '二楼' },
      { author: '丙', text: '三楼', likeCount: 7, replyCount: 2 }
    ])
  })

  it('renders embedded game cards with cover, score, and price instead of a bare link', () => {
    const result = normalizeXiaoheihePost('https://www.xiaoheihe.cn/app/bbs/link/abc123', {
      status: 'ok',
      result: {
        link: {
          title: '嵌卡帖子',
          text: JSON.stringify([
            { type: 'text', text: '开头' },
            { type: 'html', text: '<img data-gameid="730" data-original="https://img.example.test/card.jpg"/>' }
          ])
        }
      }
    }, {
      730: { name: '反恐精英', score: '9.1', scoreComment: 1200, price: '¥70', cover: 'https://img.example.test/cover.jpg' }
    })

    expect('ok' in result).toBe(false)
    if ('ok' in result) throw new Error('expected successful post result')
    expect(result.extras?.contentBlocks).toEqual([
      { type: 'text', text: '开头' },
      { type: 'image', url: 'https://img.example.test/cover.jpg' },
      { type: 'text', text: '🎮 反恐精英\n🌟 评分: 9.1 (1200人)\n💰 价格: ¥70' }
    ])
  })

  it('falls back to a plain game link when the card payload is unavailable', () => {
    const result = normalizeXiaoheihePost('https://www.xiaoheihe.cn/app/bbs/link/abc123', {
      status: 'ok',
      result: {
        link: {
          title: '缺卡片',
          text: JSON.stringify([
            { type: 'html', text: '<img data-gameid="730"/>' }
          ])
        }
      }
    })

    expect('ok' in result).toBe(false)
    if ('ok' in result) throw new Error('expected successful post result')
    expect(result.extras?.contentBlocks).toEqual([
      { type: 'text', text: '相关游戏：https://www.xiaoheihe.cn/app/topic/game/pc/730' }
    ])
  })
})

describe('optimizeXiaoheiheImageUrl', () => {
  it('adds a trailing backslash only when query params exist', () => {
    expect(optimizeXiaoheiheImageUrl('https://img.example.test/a.jpg?x=1')).toBe('https://img.example.test/a.jpg?x=1\\')
    expect(optimizeXiaoheiheImageUrl('https://img.example.test/a.jpg')).toBe('https://img.example.test/a.jpg')
  })
})
