import type { Message } from 'node-karin'
import { describe, expect, it } from 'vitest'

import type { ResolvedPost, RichCommentBlock, RichContentBlock } from '@/resolvers/types'
import {
  buildResolverCommentNodes,
  buildResolverContentNodes,
  formatResolverCommentBlock,
  resolverForwardCopy,
  resolveEventForwardIdentity
} from '@/services/resolverForward'

describe('resolver forward service', () => {
  const event = {
    user_id: '10001',
    sender: {
      user_id: '10001',
      card: '发帖人昵称',
      nickname: '用户昵称'
    },
    selfId: '3133320859'
  } as unknown as Message

  it('keeps platform copy in one shared mapping', () => {
    expect(resolverForwardCopy({ platform: 'xiaoheihe', displayName: '小黑盒帖子' })).toEqual({
      contentPrompt: '小黑盒帖子正文',
      commentPrompt: '小黑盒帖子评论',
      commentUnit: '评论'
    })
    expect(resolverForwardCopy({ platform: 'xiaohongshu', displayName: '小红书笔记' }).contentPrompt).toBe('小红书笔记正文')
    expect(resolverForwardCopy({ platform: 'weibo', displayName: '微博' }).commentPrompt).toBe('微博评论')
    expect(resolverForwardCopy({ platform: 'tieba', displayName: '贴吧' })).toEqual({
      contentPrompt: '贴吧帖子正文',
      commentPrompt: '贴吧回复',
      commentUnit: '回复'
    })
    expect(resolverForwardCopy({ platform: 'general', displayName: '通用解析' })).toEqual({
      contentPrompt: '通用解析正文',
      commentPrompt: '通用解析评论',
      commentUnit: '评论'
    })
  })

  it('uses the triggering user card for body fake-forward identity', () => {
    expect(resolveEventForwardIdentity(event, '微博')).toEqual({
      id: '10001',
      name: '发帖人昵称'
    })
  })

  it('builds one body node with ordered text and deduplicated usable images', () => {
    const post = {
      platform: 'xiaohongshu',
      displayName: '小红书笔记'
    } as ResolvedPost
    const blocks: RichContentBlock[] = [
      { type: 'text', text: '正文第一段' },
      { type: 'image', url: 'https://img.example.test/a.jpg?imageView2/2/w/1080' },
      { type: 'image', url: 'https://img.example.test/a.jpg?imageView2/2/w/240' },
      { type: 'image', url: 'https://img.example.test/a.jpg?imageMogr2/blur/50x50' },
      { type: 'text', text: '正文第二段' }
    ]

    const nodes = buildResolverContentNodes(event, post, blocks)

    expect(nodes).toHaveLength(1)
    expect(nodes[0]).toMatchObject({
      type: 'node',
      subType: 'fake',
      userId: '10001',
      nickname: '发帖人昵称'
    })
    expect(nodes[0]?.message).toMatchObject([
      { type: 'text', text: '正文第一段' },
      { type: 'image', file: 'https://img.example.test/a.jpg?imageView2/2/w/1080' },
      { type: 'text', text: '正文第二段' }
    ])
  })

  it('formats comment metadata without dangling separators', () => {
    expect(formatResolverCommentBlock({
      author: '路人',
      replyTo: '作者',
      floor: 2,
      location: '上海',
      time: '1700000000',
      text: '评论内容',
      images: []
    })).toBe('路人 回复 作者\n2楼 · 上海 · 1700000000\n\n评论内容')

    expect(formatResolverCommentBlock({
      author: '路人',
      text: '只有正文',
      images: []
    })).toBe('路人\n\n只有正文')
  })

  it('builds comment nodes per author and deduplicates comment images', () => {
    const comments: RichCommentBlock[] = [
      {
        author: '路人',
        floor: 2,
        text: '评论内容',
        images: [
          'https://img.example.test/c.jpg?imageView2/2/w/1080',
          'https://img.example.test/c.jpg?imageView2/2/w/240'
        ]
      },
      {
        author: '层主',
        replyTo: '路人',
        text: '回复内容',
        images: []
      }
    ]

    const nodes = buildResolverCommentNodes(comments)

    expect(nodes).toHaveLength(2)
    expect(nodes[0]).toMatchObject({
      type: 'node',
      subType: 'fake',
      userId: '1',
      nickname: '路人'
    })
    expect(nodes[0]?.message).toMatchObject([
      { type: 'text', text: '路人\n2楼\n\n评论内容' },
      { type: 'image', file: 'https://img.example.test/c.jpg?imageView2/2/w/1080' }
    ])
    expect(nodes[1]?.message).toMatchObject([
      { type: 'text', text: '层主 回复 路人\n\n回复内容' }
    ])
  })
})
