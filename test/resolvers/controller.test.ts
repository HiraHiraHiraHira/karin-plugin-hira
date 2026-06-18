import type { Message } from 'node-karin'
import { afterEach, describe, expect, it, vi } from 'vitest'

const karinMocks = vi.hoisted(() => ({
  render: vi.fn(async () => Buffer.from('resolver-error-card').toString('base64'))
}))

const resolverMocks = vi.hoisted(() => ({
  resolveBilibili: vi.fn(),
  resolveTieba: vi.fn(),
  resolveXiaoheihe: vi.fn()
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

vi.mock('@/resolvers/bilibili', () => ({
  resolveBilibili: resolverMocks.resolveBilibili
}))

vi.mock('@/resolvers/xiaoheihe', () => ({
  resolveXiaoheihe: resolverMocks.resolveXiaoheihe
}))

vi.mock('@/resolvers/tieba', () => ({
  resolveTieba: resolverMocks.resolveTieba
}))

describe('handleResolverMessage', () => {
  afterEach(async () => {
    vi.clearAllMocks()
    resolverMocks.resolveBilibili.mockReset()
    resolverMocks.resolveTieba.mockReset()
    resolverMocks.resolveXiaoheihe.mockReset()
    karinMocks.render.mockReset()
    karinMocks.render.mockResolvedValue(Buffer.from('resolver-error-card').toString('base64'))
    const { Config } = await import('@/config')
    Config.resolver.kkkCompat = true
    Config.resolver.platforms.bilibili = true
  })

  it('turns resolver exceptions such as ffmpeg failures into diagnostic card replies', async () => {
    resolverMocks.resolveBilibili.mockRejectedValueOnce(new Error('ffmpeg exited with code 1'))
    const { handleResolverMessage } = await import('@/resolvers/controller')
    const { Config } = await import('@/config')
    Config.resolver.kkkCompat = false
    const reply = vi.fn(async () => ({}))
    const e = {
      msg: 'https://www.bilibili.com/video/BV14A31eZEH8',
      reply
    } as unknown as Message

    await expect(handleResolverMessage(e)).resolves.toBe(true)

    expect(karinMocks.render).toHaveBeenCalledWith(expect.objectContaining({
      name: 'karin-plugin-hira/card-resolver-error-bilibili',
      selector: '#container',
      type: 'png'
    }))
    expect(reply).toHaveBeenCalledWith([
      { type: 'image', file: `base64://${Buffer.from('resolver-error-card').toString('base64')}` }
    ])
  })

  it('extracts Xiaoheihe jumpUrl from QQ json share cards and invokes the resolver', async () => {
    resolverMocks.resolveXiaoheihe.mockResolvedValueOnce({
      platform: 'xiaoheihe',
      displayName: '小黑盒帖子',
      title: '玩了五小时，说一下这个游戏',
      description: '下载小黑盒查看更多精彩内容',
      pageUrl: 'https://api.xiaoheihe.cn/v3/bbs/app/api/web/share?h_camp=link&link_id=4cef71f914bb',
      images: [],
      videos: []
    })
    const { handleResolverMessage } = await import('@/resolvers/controller')
    const reply = vi.fn(async () => ({}))
    const e = {
      msg: '[json:{"app":"com.tencent.tuwen.lua","meta":{"news":{"jumpUrl":"https://api.xiaoheihe.cn/v3/bbs/app/api/web/share?h_camp=link&link_id=4cef71f914bb","tag":"小黑盒","title":"玩了五小时，说一下这个游戏"}}}]',
      reply
    } as unknown as Message

    await expect(handleResolverMessage(e)).resolves.toBe(true)

    expect(resolverMocks.resolveXiaoheihe).toHaveBeenCalledWith(
      'https://api.xiaoheihe.cn/v3/bbs/app/api/web/share?h_camp=link&link_id=4cef71f914bb',
      expect.any(String)
    )
    expect(reply).toHaveBeenCalledWith([
      { type: 'image', file: `base64://${Buffer.from('resolver-error-card').toString('base64')}` }
    ])
  })

  it('passes disabled resolver platforms to the next handler without resolving', async () => {
    const { handleResolverMessage } = await import('@/resolvers/controller')
    const { Config } = await import('@/config')
    Config.resolver.kkkCompat = false
    Config.resolver.platforms.bilibili = false
    const next = vi.fn(() => 'next-handler')
    const e = {
      msg: 'https://www.bilibili.com/video/BV14A31eZEH8',
      reply: vi.fn()
    } as unknown as Message

    await expect(handleResolverMessage(e, next)).resolves.toBe('next-handler')

    expect(next).toHaveBeenCalled()
    expect(resolverMocks.resolveBilibili).not.toHaveBeenCalled()
    expect(karinMocks.render).not.toHaveBeenCalled()
  })

  it('passes QQ news metadata to Tieba resolver for share-card fallback', async () => {
    resolverMocks.resolveTieba.mockResolvedValueOnce({
      platform: 'tieba',
      displayName: '贴吧',
      title: '让大学生吃食堂跟害他们一样',
      description: '#(呵呵) ',
      pageUrl: 'https://tieba.baidu.com/p/10781745725?share_from=qq',
      images: ['http://tiebapic.baidu.com/forum/a.jpg'],
      videos: []
    })
    const { handleResolverMessage } = await import('@/resolvers/controller')
    const reply = vi.fn(async () => ({}))
    const e = {
      msg: '[json:{"app":"com.tencent.tuwen.lua","meta":{"news":{"desc":"#(呵呵) ","jumpUrl":"https://tieba.baidu.com/p/10781745725?share_from=qq","preview":"http://tiebapic.baidu.com/forum/a.jpg","tag":"百度贴吧","title":"让大学生吃食堂跟害他们一样"}}}]',
      reply
    } as unknown as Message

    await expect(handleResolverMessage(e)).resolves.toBe(true)

    expect(resolverMocks.resolveTieba).toHaveBeenCalledWith(
      'https://tieba.baidu.com/p/10781745725?share_from=qq',
      expect.any(Array),
      {
        desc: '#(呵呵) ',
        jumpUrl: 'https://tieba.baidu.com/p/10781745725?share_from=qq',
        preview: 'http://tiebapic.baidu.com/forum/a.jpg',
        tag: '百度贴吧',
        title: '让大学生吃食堂跟害他们一样'
      }
    )
  })
})
