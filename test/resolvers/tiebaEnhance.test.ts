import { afterEach, describe, expect, it, vi } from 'vitest'

import { normalizeHibiTiebaPost, normalizeTiebaPost, resolveTieba } from '@/resolvers/tieba'

describe('normalizeTiebaPost', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('normalizes title, text, author, images and comments', () => {
    const result = normalizeTiebaPost('https://tieba.baidu.com/p/123', {
      thread: {
        title: '帖子标题',
        author: { name: '楼主' },
        content: '<p>正文</p><img src="https://img/a.jpg">'
      },
      posts: [
        { author: { name: '路人' }, content: '回复内容', images: ['https://img/b.jpg'] }
      ]
    })

    expect(result).toMatchObject({
      platform: 'tieba',
      displayName: '贴吧',
      title: '帖子标题',
      author: '楼主',
      pageUrl: 'https://tieba.baidu.com/p/123'
    })
    expect('ok' in result).toBe(false)
    if ('ok' in result) throw new Error('expected successful result')
    expect(result.description).toContain('正文')
    expect(result.description).toContain('热门回复')
    expect(result.images).toEqual(['https://img/a.jpg', 'https://img/b.jpg'])
    expect(result.extras?.contentBlocks).toEqual([
      { type: 'text', text: '正文' },
      { type: 'image', url: 'https://img/a.jpg' }
    ])
    expect(result.extras?.commentBlocks).toEqual([
      { author: '路人', text: '回复内容', images: ['https://img/b.jpg'] }
    ])
  })

  it('normalizes HIBI-style tieba post lists', () => {
    const result = normalizeHibiTiebaPost('https://tieba.baidu.com/p/123', {
      post_list: [
        {
          title: '标题',
          content: [
            { text: '正文' },
            { cdn_src: 'https://img/a.jpg' },
            { link: 'https://video/a.mp4' }
          ]
        },
        { content: [{ text: '回复' }] }
      ]
    })

    expect(result).toMatchObject({
      platform: 'tieba',
      displayName: '贴吧',
      title: '标题',
      images: ['https://img/a.jpg'],
      videos: ['https://video/a.mp4']
    })
    expect('ok' in result).toBe(false)
    if ('ok' in result) throw new Error('expected successful result')
    expect(result.description).toContain('正文')
    expect(result.description).toContain('热门回复')
    expect(result.extras?.contentBlocks).toEqual([
      { type: 'text', text: '正文' },
      { type: 'image', url: 'https://img/a.jpg' }
    ])
    expect(result.extras?.commentBlocks).toEqual([
      { author: '匿名用户', text: '回复', images: [] }
    ])
  })

  it('resolves posts through the R-plugin HIBI tieba interface first', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      expect(url).toBe('http://0d00.us.kg:8080/api/tieba/post_detail?tid=10781745725')
      return new Response(JSON.stringify({
        post_list: [
          {
            title: '让大学生吃食堂跟害他们一样',
            author: { name: '楼主' },
            content: [
              { text: '主楼正文' },
              { cdn_src: 'https://img.tieba/a.jpg' }
            ]
          },
          {
            author: { name: '层主' },
            content: [{ text: '回复正文' }]
          }
        ]
      }), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await resolveTieba('https://tieba.baidu.com/p/10781745725?share_from=qq', [])

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(result).toMatchObject({
      platform: 'tieba',
      displayName: '贴吧',
      title: '让大学生吃食堂跟害他们一样',
      author: '楼主',
      images: ['https://img.tieba/a.jpg']
    })
    expect('ok' in result).toBe(false)
  })

  it('falls back to QQ share card metadata when Tieba APIs and HTML are unavailable', async () => {
    const fetchMock = vi.fn(async () => new Response('blocked', { status: 403 }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await resolveTieba('https://tieba.baidu.com/p/10781745725?share_from=qq', [], {
      title: '让大学生吃食堂跟害他们一样',
      desc: '#(呵呵) ',
      preview: 'http://tiebapic.baidu.com/forum/a.jpg',
      tag: '百度贴吧',
      jumpUrl: 'https://tieba.baidu.com/p/10781745725?share_from=qq'
    })

    expect(result).toMatchObject({
      platform: 'tieba',
      displayName: '贴吧',
      title: '让大学生吃食堂跟害他们一样',
      description: '#(呵呵) ',
      pageUrl: 'https://tieba.baidu.com/p/10781745725?share_from=qq',
      images: ['http://tiebapic.baidu.com/forum/a.jpg'],
      videos: []
    })
    expect('ok' in result).toBe(false)
    if ('ok' in result) throw new Error('expected successful result')
    expect(result.extras?.coverUrl).toBe('http://tiebapic.baidu.com/forum/a.jpg')
    expect(result.extras?.contentBlocks).toEqual([
      { type: 'text', text: '#(呵呵) ' },
      { type: 'image', url: 'http://tiebapic.baidu.com/forum/a.jpg' }
    ])
  })
})
