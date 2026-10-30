import type { Message } from 'node-karin'
import { segment } from 'node-karin'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { defaultConfig } from '@/config/defaults'
import { Config } from '@/config'
import type { ResolvedPost } from '@/resolvers/types'
import { clearCardRenderCache } from '@/services/cardRender'
import { bustImageUrls, nativeMusicCard, replyImage, replyMusicList, replyPlainText, replyResolvedPost, replyText, withCacheBuster } from '@/services/message'

const fsMocks = vi.hoisted(() => ({
  existsSync: vi.fn(() => false),
  statSync: vi.fn(),
  copyFileSync: vi.fn(),
  appendFileSync: vi.fn()
}))

const karinMocks = vi.hoisted(() => ({
  render: vi.fn(async () => Buffer.from('music-card').toString('base64'))
}))

const runtimeMocks = vi.hoisted(() => ({
  downloadFile: vi.fn(),
  runFfmpeg: vi.fn()
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

vi.mock('@/runtime/downloader', async () => {
  const fs = await import('node:fs')
  runtimeMocks.downloadFile.mockImplementation(async (options: { output: string }) => {
    fs.writeFileSync(options.output, Buffer.alloc(2048))
    return options.output
  })
  return { downloadFile: runtimeMocks.downloadFile }
})

vi.mock('@/runtime/ffmpeg', async () => {
  const fs = await import('node:fs')
  runtimeMocks.runFfmpeg.mockImplementation(async (options: { output: string }) => {
    fs.writeFileSync(options.output, Buffer.alloc(2048))
    return options.output
  })
  return { runFfmpeg: runtimeMocks.runFfmpeg }
})

vi.mock('@/services/previewCover', () => ({
  // 预览卡封面内联需要真实网络; 单元测试只需要它不阻塞发送时序.
  inlinePreviewCover: async (post: unknown) => post
}))

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
    clearCardRenderCache()
    fsMocks.existsSync.mockReturnValue(false)
    fsMocks.statSync.mockReset()
    karinMocks.render.mockReset()
    karinMocks.render.mockResolvedValue(Buffer.from('music-card').toString('base64'))
    defaultConfig.resolver.commentsEnabled = true
    defaultConfig.resolver.sending.contentForwardEnabled = true
    defaultConfig.resolver.sending.videoFailureFallbackEnabled = true
    defaultConfig.resolver.media.dedupeImages = true
    defaultConfig.resolver.media.filterLowQualityImages = true
    defaultConfig.resolver.media.inlinePreviewCover = true
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
      videos: [{ url: video }]
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
      videos: [{ url: 'D:/tmp/douyin.mp4' }]
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

  it('downloads remote videos lazily when sending and reuses the prepared local file', async () => {
    const reply = vi.fn(async () => ({}))
    const e = { reply } as unknown as Message
    const post: ResolvedPost = {
      platform: 'general',
      displayName: '通用解析',
      title: '标题',
      description: '简介',
      pageUrl: 'https://example.test/post/1',
      images: [],
      videos: [{ url: 'https://cdn.example.test/video.mp4' }]
    }

    await replyResolvedPost(e, post)

    const calls = reply.mock.calls as unknown as Array<[unknown]>
    // 首条回复(卡片)必须先于任何媒体下载; 远程视频下载前会有一条可撤回的占位提示.
    expect(calls[0]?.[0]).toEqual([
      { type: 'image', file: `base64://${Buffer.from('music-card').toString('base64')}` }
    ])
    expect(calls[1]?.[0]).toContain('视频下载中')
    expect(reply.mock.invocationCallOrder[0]).toBeLessThan(runtimeMocks.downloadFile.mock.invocationCallOrder[0] as number)
    expect(runtimeMocks.downloadFile).toHaveBeenCalledWith(expect.objectContaining({
      url: 'https://cdn.example.test/video.mp4',
      headers: expect.objectContaining({ Referer: 'https://example.test/' })
    }))
    const videoPayload = calls.at(-1)?.[0] as { type: string, file: string }
    expect(videoPayload.type).toBe('video')
    expect(videoPayload.file).toMatch(/^file:\/\/.*\.mp4$/)
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
    clearCardRenderCache()
    karinMocks.render.mockRejectedValueOnce(new Error('render offline'))

    await replyResolvedPost(e, {
      platform: 'weibo',
      displayName: '微博',
      ok: false,
      reason: '接口返回 403'
    })

    expect(reply).toHaveBeenCalledWith('微博解析失败：接口返回 403', { reply: true })
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
      videos: [{ url: 'https://video/xhs.mp4' }],
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
    expect(replyCalls.at(-1)?.[0]).toMatchObject({ type: 'video', file: expect.stringMatching(/^file:\/\/.*\.mp4$/) })
  })

  it('deduplicates repeated rich content images before sending fake forwards', async () => {
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
      title: '单图标题',
      description: '单图简介',
      pageUrl: 'https://www.xiaohongshu.com/explore/123',
      images: [
        'https://img/a.jpg?imageView2/2/w/1080',
        'https://img/a.jpg?imageView2/2/w/240'
      ],
      videos: [],
      extras: {
        coverUrl: 'https://img/a.jpg?imageView2/2/w/240',
        contentBlocks: [
          { type: 'text', text: '单图简介' },
          { type: 'image', url: 'https://img/a.jpg?imageView2/2/w/1080' },
          { type: 'image', url: 'https://img/a.jpg?imageView2/2/w/240' },
          { type: 'image', url: 'https://img/a.jpg?imageMogr2/blur/50x50' }
        ]
      }
    }

    await replyResolvedPost(e, post)

    const forwardCalls = sendForwardMsg.mock.calls as unknown as Array<[unknown, Array<{
      message?: Array<{ type?: string, text?: string, file?: string }>
    }>, unknown]>
    expect(forwardCalls[0]?.[1]?.[0]?.message).toEqual([
      { type: 'text', text: '单图简介' },
      { type: 'image', file: 'https://img/a.jpg?imageView2/2/w/1080' }
    ])
  })

  it('falls back to readable text and deduplicated images when rich forwards fail', async () => {
    const reply = vi.fn(async () => ({}))
    const sendForwardMsg = vi.fn(async () => {
      throw new Error('forward offline')
    })
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
      title: '标题',
      description: '正文摘要',
      pageUrl: 'https://tieba.baidu.com/p/123',
      images: [
        'https://img/a.jpg?imageView2/2/w/1080',
        'https://img/a.jpg?imageView2/2/w/240',
        'https://img/b.jpg'
      ],
      videos: [],
      extras: {
        contentBlocks: [
          { type: 'text', text: '正文' },
          { type: 'image', url: 'https://img/a.jpg?imageView2/2/w/1080' }
        ],
        commentBlocks: [
          { author: '层主', text: '回复', images: [] }
        ]
      }
    }

    await replyResolvedPost(e, post)

    const calls = reply.mock.calls as unknown as Array<[unknown]>
    expect(calls[0]?.[0]).toEqual([
      { type: 'image', file: `base64://${Buffer.from('music-card').toString('base64')}` }
    ])
    expect(calls[1]?.[0]).toEqual([
      expect.objectContaining({ type: 'text', text: expect.stringContaining('识别：贴吧，标题') }),
      { type: 'image', file: 'https://img/a.jpg?imageView2/2/w/1080' },
      { type: 'image', file: 'https://img/b.jpg' }
    ])
  })

  it('keeps Xiaohongshu cover and original link visible when video sending fails', async () => {
    const reply = vi.fn(async (payload: unknown) => {
      if (typeof payload === 'object' && payload !== null && 'type' in payload && payload.type === 'video') {
        throw new Error('remote video expired')
      }
      return {}
    })
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
      title: '视频标题',
      description: '视频正文',
      pageUrl: 'https://www.xiaohongshu.com/explore/123',
      images: ['https://img/cover.jpg'],
      videos: [{ url: 'https://video/xhs-expired.mp4' }],
      extras: {
        coverUrl: 'https://img/cover.jpg',
        contentBlocks: [
          { type: 'text', text: '视频正文' }
        ]
      }
    }

    await replyResolvedPost(e, post)

    const calls = reply.mock.calls as unknown as Array<[unknown]>
    expect(calls[0]?.[0]).toEqual([
      { type: 'image', file: `base64://${Buffer.from('music-card').toString('base64')}` }
    ])
    expect(calls.some(([payload]) => typeof payload === 'string'
      && payload.includes('视频发送失败')
      && payload.includes('https://www.xiaohongshu.com/explore/123'))).toBe(true)
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
      videos: [{ url: 'https://cdn.example.test/xhh.mp4' }],
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
      userId: '10001',
      nickname: '路人'
    })
    expect(secondForwardNodes[0]?.message).toEqual([
      { type: 'text', text: '路人 回复 作者\n2楼 · 上海\n\n评论内容' },
      { type: 'image', file: 'https://img/comment.jpg' }
    ])
    const replyCalls = reply.mock.calls as unknown as Array<[unknown]>
    expect(replyCalls.at(-1)?.[0]).toMatchObject({ type: 'video', file: expect.stringMatching(/^file:\/\/.*\.mp4$/) })
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
    const resolver = Config.resolver
    const original = resolver.commentsEnabled
    resolver.commentsEnabled = false
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
    resolver.commentsEnabled = original
  })

  it('skips rich content forwards when content forwards are disabled', async () => {
    const resolver = Config.resolver
    const original = resolver.sending.contentForwardEnabled
    resolver.sending.contentForwardEnabled = false
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
      description: '正文摘要',
      pageUrl: 'https://www.xiaohongshu.com/explore/123',
      images: ['https://img/cover.jpg'],
      videos: [],
      extras: {
        contentBlocks: [
          { type: 'text', text: '正文第一段' },
          { type: 'image', url: 'https://img/cover.jpg' }
        ]
      }
    }

    await replyResolvedPost(e, post)

    expect(reply).toHaveBeenCalledWith([
      { type: 'image', file: `base64://${Buffer.from('music-card').toString('base64')}` }
    ])
    expect(sendForwardMsg).not.toHaveBeenCalled()
    resolver.sending.contentForwardEnabled = original
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
      videos: [{ url: 'https://video/tieba.mp4' }],
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
    expect(replyCalls.at(-1)?.[0]).toMatchObject({ type: 'video', file: expect.stringMatching(/^file:\/\/.*\.mp4$/) })
  })

  it.each([
    { platform: 'bilibili', displayName: '哔哩哔哩', prompt: '哔哩哔哩正文' },
    { platform: 'kuaishou', displayName: '快手', prompt: '快手正文' },
    { platform: 'general', displayName: '通用解析', prompt: '通用解析正文' }
  ] as const)('sends $displayName rich posts through the shared preview and fake forward path', async ({ platform, displayName, prompt }) => {
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
      platform,
      displayName,
      title: '标题',
      description: '正文摘要',
      author: '作者',
      pageUrl: `https://example.test/${platform}/1`,
      images: ['https://img/cover.jpg'],
      videos: [{ url: `https://video/${platform}.mp4` }],
      extras: {
        coverUrl: 'https://img/cover.jpg',
        authorAvatar: 'https://img/avatar.jpg',
        tags: ['tag'],
        contentBlocks: [
          { type: 'text', text: '正文第一段' },
          { type: 'image', url: 'https://img/cover.jpg' }
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
        prompt,
        summary: '查看完整图文'
      })
    )
    const forwardCalls = sendForwardMsg.mock.calls as unknown as Array<[unknown, Array<{
      message?: Array<{ type?: string, text?: string, file?: string }>
    }>, unknown]>
    expect(forwardCalls[0]?.[1]?.[0]?.message).toEqual([
      { type: 'text', text: '正文第一段' },
      { type: 'image', file: 'https://img/cover.jpg' }
    ])
    const replyCalls = reply.mock.calls as unknown as Array<[unknown]>
    expect(replyCalls.at(-1)?.[0]).toMatchObject({ type: 'video', file: expect.stringMatching(/^file:\/\/.*\.mp4$/) })
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

  it('can suppress video failure fallback text from resolver sending settings', async () => {
    const resolver = Config.resolver
    const original = resolver.sending.videoFailureFallbackEnabled
    resolver.sending.videoFailureFallbackEnabled = false
    const reply = vi.fn(async (payload: unknown) => {
      if (typeof payload === 'object' && payload !== null && 'type' in payload && payload.type === 'video') {
        throw new Error('remote video expired')
      }
      return {}
    })
    const e = { reply } as unknown as Message
    const post: ResolvedPost = {
      platform: 'general',
      displayName: '通用解析',
      title: '标题',
      description: '简介',
      pageUrl: 'https://example.test/post/1',
      images: [],
      videos: [{ url: 'https://cdn.example.test/expired.mp4' }]
    }

    await replyResolvedPost(e, post)

    const calls = reply.mock.calls as unknown as Array<[unknown]>
    expect(calls.some(([payload]) => typeof payload === 'string' && payload.includes('视频发送失败'))).toBe(false)
    resolver.sending.videoFailureFallbackEnabled = original
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
      videos: [{ url: video }]
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
      videos: [{ url: video }]
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

  it('merges a separate audio track before sending resolve videos', async () => {
    const reply = vi.fn(async (_payload?: unknown) => ({}) as unknown)
    const e = { reply } as unknown as Message
    const post: ResolvedPost = {
      platform: 'bilibili',
      displayName: '哔哩哔哩',
      title: 'DASH 视频',
      description: '简介',
      pageUrl: 'https://www.bilibili.com/video/BV1',
      images: [],
      videos: [{
        url: 'https://cdn.example.test/video.m4s',
        audioUrl: 'https://cdn.example.test/audio.m4s'
      }]
    }

    await replyResolvedPost(e, post)

    expect(runtimeMocks.downloadFile).toHaveBeenCalledTimes(2)
    expect(runtimeMocks.downloadFile).toHaveBeenCalledWith(expect.objectContaining({
      url: 'https://cdn.example.test/audio.m4s'
    }))
    expect(runtimeMocks.runFfmpeg).toHaveBeenCalledWith(expect.objectContaining({
      format: 'merge',
      videoInput: expect.any(String),
      audioInput: expect.any(String)
    }))
    const lastFfmpeg = runtimeMocks.runFfmpeg.mock.calls.at(-1)?.[0] as { output: string }
    const videoPayload = reply.mock.calls.at(-1)?.[0] as { type: string, file: string }
    expect(videoPayload.type).toBe('video')
    expect(videoPayload.file).toContain(lastFfmpeg.output.replace(/\\/g, '/'))
  })

  it('sends disjoint douyin clip and image sets without further dedupe', async () => {
    const reply = vi.fn(async (_payload?: unknown) => ({}) as unknown)
    const e = { reply } as unknown as Message
    const post: ResolvedPost = {
      platform: 'douyin',
      displayName: '抖音',
      title: '图集笔记',
      description: '简介',
      pageUrl: 'https://www.douyin.com/note/123',
      images: ['https://img.example.test/cover.jpg', 'https://img.example.test/still.jpg'],
      videos: [
        { url: 'https://cdn.example.test/clip1.mp4', audioUrl: 'https://cdn.example.test/bgm1.mp3' },
        // 原声图集没有 audioUrl, 仍必须按视频发送.
        { url: 'https://cdn.example.test/clip2.mp4' }
      ]
    }

    await replyResolvedPost(e, post)

    const firstPayload = reply.mock.calls[0]?.[0] as Array<{ type?: string, file?: string }>
    expect(firstPayload).toEqual([
      { type: 'image', file: `base64://${Buffer.from('music-card').toString('base64')}` },
      { type: 'image', file: 'https://img.example.test/cover.jpg' },
      { type: 'image', file: 'https://img.example.test/still.jpg' }
    ])
    expect(runtimeMocks.downloadFile).toHaveBeenCalledWith(expect.objectContaining({
      url: 'https://cdn.example.test/clip1.mp4',
      headers: expect.objectContaining({ Referer: 'https://www.douyin.com/note/123' })
    }))
    const videoCalls = (reply.mock.calls as unknown as Array<[unknown]>).filter(([payload]) => (
      typeof payload === 'object' && payload !== null && 'type' in payload && payload.type === 'video'
    ))
    expect(videoCalls).toHaveLength(2)
  })

  it('retries failed image sends with a locally downloaded copy', async () => {
    let attempts = 0
    const reply = vi.fn(async (_payload?: unknown) => {
      attempts += 1
      if (attempts === 1) throw new Error('risk control')
      return { messageId: 'ok' }
    })
    const e = { reply } as unknown as Message
    fsMocks.statSync.mockReturnValue({ size: 2048 })

    await replyImage(e, 'https://img.example.test/a.jpg', '标题')

    expect(runtimeMocks.downloadFile).toHaveBeenCalledWith(expect.objectContaining({
      url: 'https://img.example.test/a.jpg',
      headers: expect.objectContaining({ Referer: 'https://img.example.test/' })
    }))
    expect(reply).toHaveBeenCalledTimes(2)
    const retried = reply.mock.calls[1]?.[0] as Array<{ type?: string, file?: string }>
    expect(retried[1]).toMatchObject({ type: 'image' })
    expect(retried[1]?.file).toMatch(/\.jpg$/)
    expect(retried[1]?.file).not.toMatch(/^https?:/)
  })
})

describe('reply text helpers', () => {
  it('quotes the triggering message by default and supports opting out', async () => {
    const reply = vi.fn(async () => ({}))
    const e = { reply } as unknown as Message

    await replyText(e, '交互回复')
    expect(reply).toHaveBeenLastCalledWith('Hira：交互回复', { reply: true })

    await replyText(e, '裸消息', { reply: false })
    expect(reply).toHaveBeenLastCalledWith('Hira：裸消息', { reply: false })
  })

  it('supports auto recall for temporary placeholders', async () => {
    const reply = vi.fn(async () => ({}))
    const e = { reply } as unknown as Message

    await replyPlainText(e, '语音上传中…', { recallMsg: 30 })

    expect(reply).toHaveBeenCalledWith('语音上传中…', { reply: true, recallMsg: 30 })
  })
})

describe('nativeMusicCard', () => {
  it('maps valid platform ids to native music cards', () => {
    expect(nativeMusicCard('netease', '1834567890')).toEqual({ platform: '163', id: '1834567890' })
    expect(nativeMusicCard('qq', '0039MnYb0qxYhV')).toEqual({ platform: 'qq', id: '0039MnYb0qxYhV' })
    expect(nativeMusicCard('kuwo', '228908')).toEqual({ platform: 'kuwo', id: '228908' })
    expect(nativeMusicCard('kugou', 'A1B2C3D4E5F60718293A4B5C6D7E8F90')).toEqual({
      platform: 'kugou',
      id: 'A1B2C3D4E5F60718293A4B5C6D7E8F90'
    })
  })

  it('rejects ids whose shape the platform adapter cannot render', () => {
    expect(nativeMusicCard('netease', 'song-1')).toBeUndefined()
    expect(nativeMusicCard('qq', 'abc')).toBeUndefined()
    expect(nativeMusicCard('kuwo', 'abc123')).toBeUndefined()
    expect(nativeMusicCard('kugou', 'A1B2C3D4')).toBeUndefined()
    expect(nativeMusicCard('bilibili', 'BV1xx411c7mD')).toBeUndefined()
    expect(nativeMusicCard('netease', '   ')).toBeUndefined()
  })
})

describe('withCacheBuster', () => {
  it('appends a retry parameter to ordinary urls', () => {
    const plain = withCacheBuster('https://img.example.test/a.jpg')
    expect(plain).toMatch(/^https:\/\/img\.example\.test\/a\.jpg\?hira-retry=/)

    const withQuery = withCacheBuster('https://img.example.test/a.jpg?w=1080')
    expect(withQuery).toMatch(/^https:\/\/img\.example\.test\/a\.jpg\?w=1080&hira-retry=/)
  })

  it('returns signed urls untouched so the signature stays valid', () => {
    const signed = 'https://cdn.example.test/a.jpg?sign=abc&t=1'
    expect(withCacheBuster(signed)).toBe(signed)

    const expires = 'https://cdn.example.test/a.jpg?x-expires=1700000000'
    expect(withCacheBuster(expires)).toBe(expires)

    const aws = 'https://cdn.example.test/a.jpg?X-Amz-Signature=deadbeef'
    expect(withCacheBuster(aws)).toBe(aws)

    const token = 'https://cdn.example.test/a.jpg?auth_key=abc_123'
    expect(withCacheBuster(token)).toBe(token)

    // 短签名参数同样不能追加任何字节
    const sig = 'https://cdn.example.test/a.jpg?sig=deadbeef'
    expect(withCacheBuster(sig)).toBe(sig)
  })
})

describe('bustImageUrls', () => {
  it('only rewrites http image segments', () => {
    const text = segment.text('标题')
    const remote = segment.image('https://img.example.test/a.jpg')
    const inline = segment.image('base64://AAAA')

    const result = bustImageUrls([text, remote, inline]) as unknown as Array<{ type?: string, file?: string }>

    expect(result).toHaveLength(3)
    expect(result[0]).toMatchObject({ type: 'text', text: '标题' })
    expect(result[1]?.file).toMatch(/^https:\/\/img\.example\.test\/a\.jpg\?hira-retry=/)
    expect(result[2]).toMatchObject({ type: 'image', file: 'base64://AAAA' })
  })

  it('normalizes a single element into an array before rewriting', () => {
    const result = bustImageUrls(segment.image('https://img.example.test/a.jpg')) as unknown as Array<{ file?: string }>

    expect(result).toHaveLength(1)
    expect(result[0]?.file).toMatch(/\?hira-retry=/)
  })
})
