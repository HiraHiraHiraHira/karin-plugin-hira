import { describe, expect, it } from 'vitest'

import type { ResolvedPost } from '@/resolvers/types'
import { toRichResolvedPost } from '@/resolvers/rich'

describe('toRichResolvedPost', () => {
  it.each([
    ['bilibili', '哔哩哔哩'],
    ['kuaishou', '快手'],
    ['xiaoheihe', '小黑盒帖子'],
    ['xiaohongshu', '小红书笔记'],
    ['weibo', '微博'],
    ['tieba', '贴吧'],
    ['general', '通用解析']
  ] as const)('converts %s posts into the shared rich content model', (platform, displayName) => {
    const post: ResolvedPost = {
      platform,
      displayName,
      title: '标题',
      description: '摘要',
      author: '作者',
      pageUrl: `https://example.test/${platform}/1`,
      images: [
        'https://img.example.test/a.jpg?imageView2/2/w/1080',
        'https://img.example.test/a.jpg?imageView2/2/w/240',
        'https://img.example.test/b.jpg'
      ],
      videos: ['https://video.example.test/a.mp4'],
      extras: {
        coverUrl: 'https://img.example.test/a.jpg?imageView2/2/w/240',
        authorAvatar: 'https://img.example.test/avatar.jpg',
        tags: ['tag1', 'tag2'],
        contentBlocks: [
          { type: 'text', text: '正文' },
          { type: 'image', url: 'https://img.example.test/a.jpg?imageView2/2/w/1080' },
          { type: 'image', url: 'https://img.example.test/a.jpg?imageView2/2/w/240' }
        ],
        commentBlocks: [
          { author: '路人', floor: 2, location: '上海', text: '评论', images: ['https://img.example.test/c.jpg'] }
        ],
        location: '上海',
        createdAt: '1700000000'
      }
    }

    const rich = toRichResolvedPost(post)

    expect(rich).toMatchObject({
      platform,
      displayName,
      pageUrl: post.pageUrl,
      author: {
        name: '作者',
        avatar: 'https://img.example.test/avatar.jpg'
      },
      content: {
        title: '标题',
        summary: '摘要',
        tags: ['tag1', 'tag2'],
        location: '上海',
        createdAt: '1700000000',
        blocks: [
          { type: 'text', text: '正文' },
          { type: 'image', url: 'https://img.example.test/a.jpg?imageView2/2/w/1080' }
        ]
      },
      comments: [
        { author: '路人', floor: 2, location: '上海', text: '评论', images: ['https://img.example.test/c.jpg'] }
      ],
      source: {
        url: post.pageUrl,
        platform
      }
    })
    expect(rich.media).toEqual([
      expect.objectContaining({ type: 'cover', url: 'https://img.example.test/a.jpg?imageView2/2/w/240' }),
      expect.objectContaining({ type: 'image', url: 'https://img.example.test/b.jpg' }),
      expect.objectContaining({ type: 'video', url: 'https://video.example.test/a.mp4' })
    ])
  })

  it('falls back to legal empty structures when optional fields are missing', () => {
    const rich = toRichResolvedPost({
      platform: 'weibo',
      displayName: '微博',
      videos: [],
      images: []
    })

    expect(rich).toMatchObject({
      platform: 'weibo',
      displayName: '微博',
      content: { blocks: [] },
      media: [],
      comments: []
    })
  })
})
