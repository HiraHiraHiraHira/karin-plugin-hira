import type { Message } from 'node-karin'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { defaultConfig } from '@/config/defaults'
import type { ResolvedPost } from '@/resolvers/types'
import { replyMusicList, replyResolvedPost } from '@/services/message'

const fsMocks = vi.hoisted(() => ({
  existsSync: vi.fn(() => false),
  statSync: vi.fn(),
  copyFileSync: vi.fn(),
  appendFileSync: vi.fn()
}))

const karinMocks = vi.hoisted(() => ({
  render: vi.fn(async () => Buffer.from('music-card').toString('base64'))
}))

vi.mock('node:fs', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return {
    ...actual,
    existsSync: fsMocks.existsSync,
    statSync: fsMocks.statSync,
    copyFileSync: fsMocks.copyFileSync,
    appendFileSync: fsMocks.appendFileSync
  }
})

vi.mock('node-karin', async importOriginal => {
  const actual = await importOriginal<typeof import('node-karin')>()
  return {
    ...actual,
    render: {
      ...actual.render,
      render: karinMocks.render
    }
  }
})

describe('replyResolvedPost', () => {
  afterEach(() => {
    vi.clearAllMocks()
    fsMocks.existsSync.mockReturnValue(false)
    karinMocks.render.mockReset()
    karinMocks.render.mockResolvedValue(Buffer.from('music-card').toString('base64'))
    defaultConfig.resolver.commentsEnabled = true
  })

  it('sends local videos with a file protocol like KKK', async () => {
    const reply = vi.fn(async () => ({}))
    const e = { reply } as unknown as Message
    const video = 'D:\\tmp\\douyin.mp4'
    const post: ResolvedPost = {
      platform: 'douyin',
      displayName: '抖音',
      title: '标题',
      description: '简介',
      pageUrl: 'https://www.douyin.com/video/738',
      images: [],
      videos: [video]
    }
    fsMocks.existsSync.mockReturnValue(true)
    fsMocks.statSync.mockReturnValue({ size: 25 * 1024 * 1024 })

    await replyResolvedPost(e, post)

    const calls = reply.mock.calls as unknown as Array<[unknown]>
    const videoPayload = calls[1]?.[0] as { type: string, file: string }
    expect(videoPayload.type).toBe('video')
    expect(videoPayload.file).toBe('file://D:/tmp/douyin.mp4')
    expect(fsMocks.copyFileSync).not.toHaveBeenCalled()
    expect(fsMocks.appendFileSync).not.toHaveBeenCalled()
  })

  it('sends resolved videos as a separate message after text and images', async () => {
    const reply = vi.fn(async () => ({}))
    const e = { reply } as unknown as Message
    const post: ResolvedPost = {
      platform: 'douyin',
      displayName: '抖音',
      title: '标题',
      description: '简介',
      pageUrl: 'https://www.douyin.com/video/738',
      images: ['https://img/cover.jpg'],
      videos: ['D:/tmp/douyin.mp4']
    }

    await replyResolvedPost(e, post)

    const calls = reply.mock.calls as unknown as Array<[unknown]>
    expect(reply).toHaveBeenCalledTimes(2)
    expect(calls[0]?.[0]).toEqual([
      { type: 'image', file: `base64://${Buffer.from('music-card').toString('base64')}` },
      { type: 'image', file: 'https://img/cover.jpg' }
    ])
    expect(calls[1]?.[0]).toMatchObject({ type: 'video', file: 'file://D:/tmp/douyin.mp4' })
  })

  it('keeps remote video urls unchanged when sending resolver videos', async () => {
    const reply = vi.fn(async () => ({}))
    const e = { reply } as unknown as Message
    const post: ResolvedPost = {
      platform: 'general',
      displayName: '通用解析',
      title: '标题',
      description: '简介',
      pageUrl: 'https://example.test/post/1',
      images: [],
      videos: ['https://cdn.example.test/video.mp4']
    }

    await replyResolvedPost(e, post)

    const calls = reply.mock.calls as unknown as Array<[unknown]>
    expect(calls[1]?.[0]).toEqual({ type: 'video', file: 'https://cdn.example.test/video.mp4' })
  })

  it('does not add the configured reply prefix to resolver result messages', async () => {
    const reply = vi.fn(async () => ({}))
    const e = { reply } as unknown as Message
    const post: ResolvedPost = {
      platform: 'douyin',
      displayName: '抖音',
      title: '标题',
      description: '简介',
      pageUrl: 'https://www.douyin.com/video/738',
      images: [],
      videos: []
    }

    await replyResolvedPost(e, post)

    const calls = reply.mock.calls as unknown as Array<[unknown]>
    expect(calls[0]?.[0]).toEqual([
      { type: 'image', file: `base64://${Buffer.from('music-card').toString('base64')}` }
    ])
  })

  it('falls back to plain resolver text when resolver card rendering fails', async () => {
    const reply = vi.fn(async () => ({}))
    const e = { reply } as unknown as Message
    const post: ResolvedPost = {
      platform: 'douyin',
      displayName: '抖音',
      title: '标题',
      description: '简介',
      pageUrl: 'https://www.douyin.com/video/738',
      images: [],
      videos: []
    }
    karinMocks.render.mockRejectedValueOnce(new Error('render offline'))

    await replyResolvedPost(e, post)

    const calls = reply.mock.calls as unknown as Array<[unknown]>
    const payload = calls[0]?.[0] as Array<{ type?: string, text?: string }>
    const text = payload.find(item => item.type === 'text')?.text
    expect(text).toContain('识别：抖音，标题')
    expect(text).not.toContain('Hira：')
  })

  it('renders resolver failures as a diagnostic card and falls back to text if rendering fails', async () => {
    const reply = vi.fn(async () => ({}))
    const e = { reply } as unknown as Message

    await replyResolvedPost(e, {
      platform: 'weibo',
      displayName: '微博',
      ok: false,
      reason: '接口返回 403'
    })

    expect(reply).toHaveBeenCalledWith([
      { type: 'image', file: `base64://${Buffer.from('music-card').toString('base64')}` }
    ])

    vi.clearAllMocks()
    karinMocks.render.mockRejectedValueOnce(new Error('render offline'))

    await replyResolvedPost(e, {
      platform: 'weibo',
      displayName: '微博',
      ok: false,
      reason: '接口返回 403'
    })

    expect(reply).toHaveBeenCalledWith('微博解析失败：接口返回 403')
  })

  it('sends Xiaohongshu rich notes as card first and forwards body content after it', async () => {
    const reply = vi.fn(async () => ({}))
    const sendForwardMsg = vi.fn(async () => ({ messageId: 'forward-message' }))
    const contact = { scene: 'group', peer: '887223378', name: '测试群' }
    const e = {
      reply,
      contact,
      user_id: '10001',
      sender: {
        user_id: '10001',
        card: '发帖人昵称',
        nickname: '用户昵称'
      },
      selfId: '3133320859',
      bot: {
        account: { selfId: '3133320859', name: 'Hira' },
        sendForwardMsg
      }
    } as unknown as Message
    const post: ResolvedPost = {
      platform: 'xiaohongshu',
      displayName: '小红书笔记',
      title: '图集标题',
      description: '图集简介',
      pageUrl: 'https://www.xiaohongshu.com/explore/123',
      images: ['https://img/1.jpg', 'https://img/2.jpg'],
      videos: ['https://video/xhs.mp4'],
      extras: {
        coverUrl: 'https://img/1.jpg',
        contentBlocks: [
          { type: 'text', text: '图集简介' },
          { type: 'image', url: 'https://img/1.jpg' },
          { type: 'image', url: 'https://img/2.jpg' }
        ]
      }
    }

    await replyResolvedPost(e, post)

    expect(reply).toHaveBeenCalledWith([
      { type: 'image', file: `base64://${Buffer.from('music-card').toString('base64')}` }
    ])
    expect(sendForwardMsg).toHaveBeenCalledTimes(1)
    expect(sendForwardMsg).toHaveBeenCalledWith(
      contact,
      expect.any(Array),
      expect.objectContaining({
        prompt: '小红书笔记正文',
        summary: '查看完整图文'
      })
    )
    const forwardCalls = sendForwardMsg.mock.calls as unknown as Array<[unknown, Array<{
      subType?: string
      userId?: string
      nickname?: string
      message?: Array<{ type?: string, text?: string, file?: string }>
    }>, unknown]>
    const firstForwardNodes = forwardCalls[0]?.[1] || []
    expect(firstForwardNodes).toHaveLength(1)
    expect(firstForwardNodes[0]).toMatchObject({
      type: 'node',
      subType: 'fake',
      userId: '10001',
      nickname: '发帖人昵称'
    })
    expect(firstForwardNodes[0]?.message).toEqual([
      { type: 'text', text: '图集简介' },
      { type: 'image', file: 'https://img/1.jpg' },
      { type: 'image', file: 'https://img/2.jpg' }
    ])
    const replyCalls = reply.mock.calls as unknown as Array<[unknown]>
    expect(replyCalls.at(-1)?.[0]).toEqual({ type: 'video', file: 'https://video/xhs.mp4' })
  })

  it('sends Xiaoheihe rich posts as card first and forwards content and comments after it', async () => {
    const reply = vi.fn(async () => ({}))
    const sendForwardMsg = vi.fn(async () => ({ messageId: 'forward-message' }))
    const contact = { scene: 'group', peer: '887223378', name: '测试群' }
    const e = {
      reply,
      contact,
      user_id: '10001',
      sender: {
        user_id: '10001',
        card: '发帖人昵称',
        nickname: '用户昵称'
      },
      selfId: '3133320859',
      bot: {
        account: { selfId: '3133320859', name: 'Hira' },
        sendForwardMsg
      }
    } as unknown as Message
    const post: ResolvedPost = {
      platform: 'xiaoheihe',
      displayName: '小黑盒帖子',
      title: '图文混排帖子',
      description: '摘要',
      pageUrl: 'https://www.xiaoheihe.cn/app/bbs/link/abc123',
      images: ['https://img/cover.jpg'],
      videos: ['https://cdn.example.test/xhh.mp4'],
      extras: {
        contentBlocks: [
          { type: 'text', text: '正文第一段' },
          { type: 'image', url: 'https://img/a.jpg' },
          { type: 'text', text: '正文第二段' }
        ],
        commentBlocks: [
          {
            author: '路人',
            replyTo: '作者',
            floor: 2,
            location: '上海',
            text: '评论内容',
            images: ['https://img/comment.jpg']
          }
        ]
      }
    }

    await replyResolvedPost(e, post)

    expect(reply).toHaveBeenCalledWith([
      { type: 'image', file: `base64://${Buffer.from('music-card').toString('base64')}` }
    ])
    expect(sendForwardMsg).toHaveBeenCalledTimes(2)
    expect(sendForwardMsg).toHaveBeenNthCalledWith(
      1,
      contact,
      expect.any(Array),
      expect.objectContaining({
        prompt: '小黑盒帖子正文',
        summary: '查看完整图文'
      })
    )
    expect(sendForwardMsg).toHaveBeenNthCalledWith(
      2,
      contact,
      expect.any(Array),
      expect.objectContaining({
        prompt: '小黑盒帖子评论',
        summary: '查看1条评论'
      })
    )
    const forwardCalls = sendForwardMsg.mock.calls as unknown as Array<[unknown, Array<{
      subType?: string
      userId?: string
      nickname?: string
      message?: Array<{ type?: string, text?: string, file?: string }>
    }>, unknown]>
    const firstForwardNodes = forwardCalls[0]?.[1] || []
    expect(firstForwardNodes).toHaveLength(1)
    expect(firstForwardNodes[0]).toMatchObject({
      type: 'node',
      subType: 'fake',
      userId: '10001',
      nickname: '发帖人昵称'
    })
    expect(firstForwardNodes[0]?.message).toEqual([
      { type: 'text', text: '正文第一段' },
      { type: 'image', file: 'https://img/a.jpg' },
      { type: 'text', text: '正文第二段' }
    ])
    const secondForwardNodes = forwardCalls[1]?.[1] || []
    expect(secondForwardNodes).toHaveLength(1)
    expect(secondForwardNodes[0]).toMatchObject({
      type: 'node',
      subType: 'fake',
      userId: '1',
      nickname: '路人'
    })
    expect(secondForwardNodes[0]?.message).toEqual([
      { type: 'text', text: '路人 回复 作者\n2楼 · 上海\n\n评论内容' },
      { type: 'image', file: 'https://img/comment.jpg' }
    ])
    const replyCalls = reply.mock.calls as unknown as Array<[unknown]>
    expect(replyCalls.at(-1)?.[0]).toEqual({ type: 'video', file: 'https://cdn.example.test/xhh.mp4' })
  })

  it('sends Weibo rich posts with the shared preview card and fake forwards', async () => {
    const reply = vi.fn(async () => ({}))
    const sendForwardMsg = vi.fn(async () => ({ messageId: 'forward-message' }))
    const contact = { scene: 'group', peer: '887223378', name: '测试群' }
    const e = {
      reply,
      contact,
      user_id: '10001',
      sender: {
        user_id: '10001',
        card: '发帖人昵称',
        nickname: '用户昵称'
      },
      selfId: '3133320859',
      bot: {
        account: { selfId: '3133320859', name: 'Hira' },
        sendForwardMsg
      }
    } as unknown as Message
    const post: ResolvedPost = {
      platform: 'weibo',
      displayName: '微博',
      title: '微博标题',
      description: '正文摘要',
      pageUrl: 'https://weibo.com/123/abc',
      images: ['https://img/cover.jpg'],
      videos: [],
      extras: {
        contentBlocks: [
          { type: 'text', text: '正文第一段' },
          { type: 'image', url: 'https://img/a.jpg' }
        ],
        commentBlocks: [
          { author: '路人', text: '评论内容', images: [] }
        ]
      }
    }

    await replyResolvedPost(e, post)

    expect(reply).toHaveBeenCalledWith([
      { type: 'image', file: `base64://${Buffer.from('music-card').toString('base64')}` }
    ])
    expect(sendForwardMsg).toHaveBeenCalledTimes(2)
    expect(sendForwardMsg).toHaveBeenNthCalledWith(
      1,
      contact,
      expect.any(Array),
      expect.objectContaining({
        prompt: '微博正文',
        summary: '查看完整图文'
      })
    )
    expect(sendForwardMsg).toHaveBeenNthCalledWith(
      2,
      contact,
      expect.any(Array),
      expect.objectContaining({
        prompt: '微博评论',
        summary: '查看1条评论'
      })
    )
  })

  it('skips rich comment forwards when resolver comments are disabled', async () => {
    defaultConfig.resolver.commentsEnabled = false
    const reply = vi.fn(async () => ({}))
    const sendForwardMsg = vi.fn(async () => ({ messageId: 'forward-message' }))
    const contact = { scene: 'group', peer: '887223378', name: '测试群' }
    const e = {
      reply,
      contact,
      user_id: '10001',
      sender: {
        user_id: '10001',
        card: '发帖人昵称',
        nickname: '用户昵称'
      },
      selfId: '3133320859',
      bot: {
        account: { selfId: '3133320859', name: 'Hira' },
        sendForwardMsg
      }
    } as unknown as Message
    const post: ResolvedPost = {
      platform: 'weibo',
      displayName: '微博',
      title: '微博标题',
      description: '正文摘要',
      pageUrl: 'https://weibo.com/123/abc',
      images: ['https://img/cover.jpg'],
      videos: [],
      extras: {
        contentBlocks: [
          { type: 'text', text: '正文第一段' }
        ],
        commentBlocks: [
          { author: '路人', text: '评论内容', images: [] }
        ]
      }
    }

    await replyResolvedPost(e, post)

    expect(reply).toHaveBeenCalledWith([
      { type: 'image', file: `base64://${Buffer.from('music-card').toString('base64')}` }
    ])
    expect(sendForwardMsg).toHaveBeenCalledTimes(1)
    expect(sendForwardMsg).toHaveBeenCalledWith(
      contact,
      expect.any(Array),
      expect.objectContaining({
        prompt: '微博正文',
        summary: '查看完整图文'
      })
    )
  })

  it('sends Tieba rich posts with the shared preview card and fake forwards', async () => {
    const reply = vi.fn(async () => ({}))
    const sendForwardMsg = vi.fn(async () => ({ messageId: 'forward-message' }))
    const contact = { scene: 'group', peer: '887223378', name: '测试群' }
    const e = {
      reply,
      contact,
      user_id: '10001',
      sender: {
        user_id: '10001',
        card: '发帖人昵称',
        nickname: '用户昵称'
      },
      selfId: '3133320859',
      bot: {
        account: { selfId: '3133320859', name: 'Hira' },
        sendForwardMsg
      }
    } as unknown as Message
    const post: ResolvedPost = {
      platform: 'tieba',
      displayName: '贴吧',
      title: '贴吧标题',
      description: '正文摘要',
      pageUrl: 'https://tieba.baidu.com/p/123',
      images: ['https://img/cover.jpg'],
      videos: ['https://video/tieba.mp4'],
      extras: {
        contentBlocks: [
          { type: 'text', text: '楼主正文' },
          { type: 'image', url: 'https://img/a.jpg' }
        ],
        commentBlocks: [
          { author: '层主', floor: 2, text: '回复内容', images: [] }
        ]
      }
    }

    await replyResolvedPost(e, post)

    expect(reply).toHaveBeenCalledWith([
      { type: 'image', file: `base64://${Buffer.from('music-card').toString('base64')}` }
    ])
    expect(sendForwardMsg).toHaveBeenCalledTimes(2)
    expect(sendForwardMsg).toHaveBeenNthCalledWith(
      1,
      contact,
      expect.any(Array),
      expect.objectContaining({
        prompt: '贴吧帖子正文',
        summary: '查看完整图文'
      })
    )
    expect(sendForwardMsg).toHaveBeenNthCalledWith(
      2,
      contact,
      expect.any(Array),
      expect.objectContaining({
        prompt: '贴吧回复',
        summary: '查看1条回复'
      })
    )
    const replyCalls = reply.mock.calls as unknown as Array<[unknown]>
    expect(replyCalls.at(-1)?.[0]).toEqual({ type: 'video', file: 'https://video/tieba.mp4' })
  })

  it('sends long resolver descriptions as a merged forward message', async () => {
    const reply = vi.fn(async () => ({}))
    const sendForwardMsg = vi.fn(async () => ({ messageId: 'forward-message' }))
    const contact = { scene: 'group', peer: '887223378', name: '测试群' }
    const e = {
      reply,
      contact,
      selfId: '3133320859',
      bot: {
        account: { selfId: '3133320859', name: 'Hira' },
        sendForwardMsg
      }
    } as unknown as Message
    const post: ResolvedPost = {
      platform: 'weibo',
      displayName: '微博',
      title: '长文标题',
      description: '长文内容'.repeat(120),
      pageUrl: 'https://weibo.com/123/abc',
      images: [],
      videos: []
    }

    await replyResolvedPost(e, post)

    expect(reply).not.toHaveBeenCalled()
    expect(sendForwardMsg).toHaveBeenCalledWith(
      contact,
      expect.any(Array),
      expect.objectContaining({
        prompt: '微博解析结果',
        summary: '查看完整解析内容'
      })
    )
  })

  it('uploads local group videos as files when they exceed the message size limit', async () => {
    const reply = vi.fn(async () => ({}))
    const uploadFile = vi.fn(async () => undefined)
    const contact = { scene: 'group', peer: '887223378', name: '测试群' }
    const e = {
      reply,
      contact,
      bot: { uploadFile }
    } as unknown as Message
    const video = 'D:\\tmp\\bilibili.mp4'
    const post: ResolvedPost = {
      platform: 'bilibili',
      displayName: '哔哩哔哩',
      title: '标题',
      description: '简介',
      pageUrl: 'https://www.bilibili.com/video/BV1',
      images: ['https://img/cover.jpg'],
      videos: [video]
    }
    fsMocks.existsSync.mockReturnValue(true)
    fsMocks.statSync.mockReturnValue({ size: 101 * 1024 * 1024 })

    await replyResolvedPost(e, post)

    const calls = reply.mock.calls as unknown as Array<[unknown]>
    expect(uploadFile).toHaveBeenCalledWith(contact, video, 'bilibili.mp4')
    expect(calls.some(([payload]) => (
      Boolean(Array.isArray(payload)
        ? payload.some(item => typeof item === 'object' && item && 'type' in item && item.type === 'video')
        : typeof payload === 'object' && payload !== null && 'type' in payload && payload.type === 'video')
    ))).toBe(false)
    expect(calls.some(([payload]) => typeof payload === 'string' && payload.includes('改为上传群文件'))).toBe(true)
  })

  it('reports upload failures without throwing when oversized video file upload times out', async () => {
    const reply = vi.fn(async () => ({}))
    const uploadFile = vi.fn(async () => {
      throw new Error('请求超时')
    })
    const contact = { scene: 'group', peer: '887223378', name: '测试群' }
    const e = {
      reply,
      contact,
      bot: { uploadFile }
    } as unknown as Message
    const video = 'D:\\tmp\\bilibili.mp4'
    const post: ResolvedPost = {
      platform: 'bilibili',
      displayName: '哔哩哔哩',
      title: '标题',
      description: '简介',
      pageUrl: 'https://www.bilibili.com/video/BV1',
      images: ['https://img/cover.jpg'],
      videos: [video]
    }
    fsMocks.existsSync.mockReturnValue(true)
    fsMocks.statSync.mockReturnValue({ size: 355 * 1024 * 1024 })

    await expect(replyResolvedPost(e, post)).resolves.toBeUndefined()

    const calls = reply.mock.calls as unknown as Array<[unknown]>
    expect(uploadFile).toHaveBeenCalledWith(contact, video, 'bilibili.mp4')
    expect(calls.some(([payload]) => typeof payload === 'string' && payload.includes('上传群文件失败'))).toBe(true)
    expect(calls.some(([payload]) => typeof payload === 'string' && payload.includes('请求超时'))).toBe(true)
  })

  it('renders music selection lists as a card image without reply prefix', async () => {
    const reply = vi.fn(async () => ({}))
    const e = { reply } as unknown as Message

    await replyMusicList(e, [
      {
        id: '1',
        source: 'qq',
        title: '晴天',
        artists: ['周杰伦'],
        pageUrl: 'https://y.qq.com/song/1',
        durationSeconds: 269
      },
      {
        id: '2',
        source: 'qq',
        title: '稻香',
        artists: ['周杰伦'],
        pageUrl: 'https://y.qq.com/song/2',
        durationSeconds: 223
      }
    ], 1)

    expect(karinMocks.render).toHaveBeenCalledWith(expect.objectContaining({
      name: 'karin-plugin-hira/card-music-list',
      selector: '#container',
      type: 'png'
    }))
    expect(reply).toHaveBeenCalledWith([
      { type: 'image', file: `base64://${Buffer.from('music-card').toString('base64')}` }
    ])
  })
})
