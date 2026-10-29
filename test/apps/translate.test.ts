import type { Message } from 'node-karin'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { extractQuotedText, translateHandler, translateReg, translateTargetOnlyReg } from '@/apps/translate'

// 翻译服务会打真实网络，这里只保留 handler 的接线行为。
const translateServiceMocks = vi.hoisted(() => ({
  translateText: vi.fn(async (text: string, target: string) => `${target}:${text}`)
}))

vi.mock('@/translate/service', () => ({
  translateText: translateServiceMocks.translateText
}))

type QuotedFixtureOptions = {
  /** 事件自身元素，默认带一个指向 messageId=42 的引用段 */
  elements?: unknown[]
  /** getMsg 的实现：返回引用消息的完整响应体 */
  getMsg: () => Promise<unknown>
  msg?: string
}

/** 伪造消息事件：contact 与元素都对齐 karin 的真实结构，便于断言 getMsg 入参。 */
const quotedFixture = (options: QuotedFixtureOptions) => {
  const reply = vi.fn(async (_payload?: unknown) => ({}))
  const getMsg = vi.fn(options.getMsg)
  const contact = { scene: 'group', peer: '10001' }
  const e = {
    msg: options.msg ?? '',
    elements: options.elements ?? [{ type: 'reply', messageId: '42' }],
    contact,
    bot: { getMsg },
    reply
  } as unknown as Message
  return { e, reply, getMsg, contact }
}

describe('extractQuotedText', () => {
  it('reads text segments from MessageResponse.elements', async () => {
    const { e, getMsg, contact } = quotedFixture({
      getMsg: async () => ({ elements: [{ type: 'text', text: '你好' }, { type: 'face', id: 1 }] })
    })

    await expect(extractQuotedText(e)).resolves.toBe('你好')
    expect(getMsg).toHaveBeenCalledWith(contact, '42')
  })

  it('falls back to the legacy message field', async () => {
    const { e } = quotedFixture({
      getMsg: async () => ({ message: [{ type: 'text', text: '旧格式' }] })
    })

    await expect(extractQuotedText(e)).resolves.toBe('旧格式')
  })

  it('returns undefined when getMsg rejects', async () => {
    const { e } = quotedFixture({
      getMsg: async () => { throw new Error('recalled') }
    })

    await expect(extractQuotedText(e)).resolves.toBeUndefined()
  })

  it('returns undefined when the message has no reply segment', async () => {
    const { e, getMsg } = quotedFixture({
      elements: [{ type: 'text', text: '你好' }],
      getMsg: async () => ({ elements: [{ type: 'text', text: '不该被读到' }] })
    })

    await expect(extractQuotedText(e)).resolves.toBeUndefined()
    expect(getMsg).not.toHaveBeenCalled()
  })
})

describe('translate command patterns', () => {
  it('accepts the trans alias with body and keeps bare targets out', () => {
    expect(translateReg.test('transen hello')).toBe(true)
    expect(translateReg.test('翻英文 hello')).toBe(true)
    expect(translateReg.test('#trans英 你好')).toBe(true)
    expect(translateReg.test('翻英文')).toBe(false)
    expect(translateReg.test('transen')).toBe(false)
    expect(translateTargetOnlyReg.test('trans日')).toBe(true)
    expect(translateTargetOnlyReg.test('#翻英')).toBe(true)
  })
})

describe('translateHandler', () => {
  beforeEach(() => {
    translateServiceMocks.translateText.mockClear()
  })

  it('translates body commands such as #trans英', async () => {
    const { e, reply, getMsg } = quotedFixture({
      msg: '#trans英 你好',
      getMsg: async () => ({ elements: [] })
    })

    await expect(translateHandler(e)).resolves.toBe(true)

    expect(translateServiceMocks.translateText).toHaveBeenCalledWith('你好', 'en')
    expect(getMsg).not.toHaveBeenCalled()
    expect(String(reply.mock.calls[0]?.[0])).toContain('en:你好')
  })

  it('translates prefixed target-only commands with a quoted body', async () => {
    const { e, reply } = quotedFixture({
      msg: '#翻英',
      getMsg: async () => ({ elements: [{ type: 'text', text: '引用文字' }] })
    })

    await expect(translateHandler(e)).resolves.toBe(true)

    expect(translateServiceMocks.translateText).toHaveBeenCalledWith('引用文字', 'en')
    expect(String(reply.mock.calls[0]?.[0])).not.toContain('请附上要翻译的文本')
    expect(String(reply.mock.calls[0]?.[0])).toContain('en:引用文字')
  })

  it('prompts for text when a target-only command has no quoted body', async () => {
    const { e, reply } = quotedFixture({
      msg: '翻英',
      getMsg: async () => ({ elements: [{ type: 'face', id: 1 }] })
    })

    await expect(translateHandler(e)).resolves.toBe(true)

    expect(translateServiceMocks.translateText).not.toHaveBeenCalled()
    expect(String(reply.mock.calls[0]?.[0])).toContain('请附上要翻译的文本')
  })
})
