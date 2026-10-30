import type { Message } from 'node-karin'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const configMock = vi.hoisted(() => ({
  app: {
    enabled: true,
    helpCommand: '#Hira帮助',
    statusCommand: '#Hira状态',
    replyPrefix: 'Hira'
  },
  ai: {
    summaryEnabled: true,
    apiBaseUrl: 'https://api.test/v1',
    apiKey: 'sk-test',
    model: 'gpt-test',
    maxInputChars: 50000,
    autoSummaryDomains: ['mp.weixin.qq.com', 'github.com']
  }
}))

const summaryServiceMock = vi.hoisted(() => ({ summarizeUrl: vi.fn() }))

vi.mock('@/config', () => ({ Config: configMock }))
// 保留 describeSummarySource / isAutoSummaryHost 的真实实现，只替换会打网络的 summarizeUrl。
vi.mock('@/summary/service', async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>
  return { ...actual, summarizeUrl: summaryServiceMock.summarizeUrl }
})

import { summaryAutoHandler, summaryHandler } from '@/apps/summary'

const createEvent = (msg: string) => {
  const reply = vi.fn(async (_payload?: unknown, _options?: unknown) => ({}))
  const sendForwardMsg = vi.fn(async (_contact?: unknown, _elements?: unknown, _options?: unknown) => ({ messageId: '99' }))
  const e = {
    msg,
    reply,
    bot: { sendForwardMsg },
    contact: { scene: 'group', peer: '10001' },
    userId: '10001',
    selfId: '2',
    sender: { userId: '10001', card: 'tester' }
  } as unknown as Message
  return { e, reply, sendForwardMsg }
}

describe('summary command', () => {
  beforeEach(() => {
    summaryServiceMock.summarizeUrl.mockReset()
    summaryServiceMock.summarizeUrl.mockResolvedValue({
      model: 'gpt-test',
      charCount: 1200,
      readingMinutes: 2,
      content: '总结正文'
    })
    configMock.ai.summaryEnabled = true
  })

  it('链接后面跟多余文字时按第一条链接总结，并合并转发结果', async () => {
    const { e, sendForwardMsg } = createEvent('#总结一下 https://example.test/a 这是多余的说明')

    await expect(summaryHandler(e)).resolves.toBe(true)

    expect(summaryServiceMock.summarizeUrl).toHaveBeenCalledWith('https://example.test/a', '10001')
    expect(sendForwardMsg).toHaveBeenCalledTimes(1)
    const [, nodes, options] = sendForwardMsg.mock.calls[0] as unknown as [unknown, unknown[], { source: string }]
    expect(nodes).toHaveLength(3)
    expect(options.source).toBe('网页总结')
  })

  it('非法链接回链接格式无效，而不是静默丢弃', async () => {
    const { e, reply } = createEvent('#总结一下 这不是链接')

    await expect(summaryHandler(e)).resolves.toBe(true)

    expect(summaryServiceMock.summarizeUrl).not.toHaveBeenCalled()
    expect(String(reply.mock.calls[0]?.[0])).toContain('链接格式无效')
  })

  it('适配器不支持合并转发时退回纯文本', async () => {
    const reply = vi.fn(async (_payload?: unknown, _options?: unknown) => ({}))
    const e = { msg: '#总结一下 https://example.test/a', reply, bot: {}, contact: {}, userId: '1', selfId: '2' } as unknown as Message

    await expect(summaryHandler(e)).resolves.toBe(true)

    const sent = reply.mock.calls.map(call => String(call[0])).join('\n')
    expect(sent).toContain('总结正文')
  })
})

describe('auto summary trigger', () => {
  beforeEach(() => {
    summaryServiceMock.summarizeUrl.mockReset()
    summaryServiceMock.summarizeUrl.mockResolvedValue({
      model: 'gpt-test',
      charCount: 800,
      readingMinutes: 2,
      content: '自动总结正文'
    })
    configMock.ai.summaryEnabled = true
  })

  it('消息里出现配置域名的链接时自动总结', async () => {
    const { e } = createEvent('这篇文章不错 https://mp.weixin.qq.com/s/abcdef 推荐看看')

    await expect(summaryAutoHandler(e)).resolves.toBe(true)

    expect(summaryServiceMock.summarizeUrl).toHaveBeenCalledWith('https://mp.weixin.qq.com/s/abcdef', '10001')
  })

  it('子域名同样命中配置域名', async () => {
    const { e } = createEvent('https://www.github.com/owner/repo')

    await expect(summaryAutoHandler(e)).resolves.toBe(true)

    expect(summaryServiceMock.summarizeUrl).toHaveBeenCalledWith('https://www.github.com/owner/repo', '10001')
  })

  it('未配置的域名不触发，静默放行', async () => {
    const { e } = createEvent('https://unknown.test/article')
    const next = vi.fn(() => 'next')

    await expect(summaryAutoHandler(e, next)).resolves.toBe('next')

    expect(summaryServiceMock.summarizeUrl).not.toHaveBeenCalled()
    expect(next).toHaveBeenCalled()
  })

  it('未开启网页总结时不触发', async () => {
    configMock.ai.summaryEnabled = false
    const { e } = createEvent('https://mp.weixin.qq.com/s/abcdef')
    const next = vi.fn(() => 'next')

    await expect(summaryAutoHandler(e, next)).resolves.toBe('next')
    expect(summaryServiceMock.summarizeUrl).not.toHaveBeenCalled()
  })

  it('显式 #总结一下 不受自动触发重复处理', async () => {
    const { e } = createEvent('#总结一下 https://mp.weixin.qq.com/s/abcdef')
    const next = vi.fn(() => 'next')

    await expect(summaryAutoHandler(e, next)).resolves.toBe('next')
    expect(summaryServiceMock.summarizeUrl).not.toHaveBeenCalled()
  })
})
