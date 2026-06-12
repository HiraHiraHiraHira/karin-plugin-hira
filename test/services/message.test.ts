import type { Message } from 'node-karin'
import { afterEach, describe, expect, it, vi } from 'vitest'

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
    karinMocks.render.mockResolvedValue(Buffer.from('music-card').toString('base64'))
  })

  it('sends local videos through a unique copy to avoid protocol media cache reuse', async () => {
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
    expect(videoPayload.file).not.toBe(`file://${video}`)
    expect(videoPayload.file).toMatch(/^file:\/\/.*douyin\.send-\d+-[a-z0-9]+\.mp4$/)
    const copiedFile = videoPayload.file.replace(/^file:\/\//, '')
    const copiedLocalFile = copiedFile.replace(/\//g, '\\')
    expect(fsMocks.copyFileSync).toHaveBeenCalledWith(video, copiedLocalFile)
    expect(fsMocks.appendFileSync).toHaveBeenCalledWith(copiedLocalFile, expect.any(Buffer))
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
      expect.objectContaining({ type: 'text', text: expect.stringContaining('识别：抖音，标题') }),
      { type: 'image', file: 'https://img/cover.jpg' }
    ])
    expect(calls[1]?.[0]).toEqual({ type: 'video', file: 'file://D:/tmp/douyin.mp4' })
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
    const payload = calls[0]?.[0] as Array<{ type?: string, text?: string }>
    const text = payload.find(item => item.type === 'text')?.text
    expect(text).toContain('识别：抖音，标题')
    expect(text).not.toContain('Hira：')
  })

  it('sends multi-image resolver results as a merged forward message', async () => {
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
      platform: 'xiaohongshu',
      displayName: '小红书',
      title: '图集标题',
      description: '图集简介',
      pageUrl: 'https://www.xiaohongshu.com/explore/123',
      images: ['https://img/1.jpg', 'https://img/2.jpg'],
      videos: []
    }

    await replyResolvedPost(e, post)

    expect(reply).not.toHaveBeenCalled()
    expect(sendForwardMsg).toHaveBeenCalledWith(
      contact,
      expect.arrayContaining([
        expect.objectContaining({ type: 'node' })
      ]),
      expect.objectContaining({
        prompt: '小红书解析结果',
        summary: '查看2张图片'
      })
    )
    const forwardCalls = sendForwardMsg.mock.calls as unknown as Array<[unknown, Array<{ nickname?: string }>, unknown]>
    expect(forwardCalls[0]?.[1].map(node => node.nickname)).toEqual(['小红书解析', '小红书解析', '小红书解析'])
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
