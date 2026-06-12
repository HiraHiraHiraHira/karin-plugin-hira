import { describe, expect, it } from 'vitest'

import { normalizeHibiTiebaPost, normalizeTiebaPost } from '@/resolvers/tieba'

describe('normalizeTiebaPost', () => {
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
  })
})
