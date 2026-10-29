import { beforeEach, describe, expect, it, vi } from 'vitest'

// 翻译服务按 target 决定走 DeepLX 还是 tencent 兼容接口，这里验证路由与请求体。
const configMock = vi.hoisted(() => ({
  translate: {
    timeoutSeconds: 5,
    deeplxApi: 'https://deeplx.test/translate',
    tencentApi: 'https://tencent.test/translate'
  }
}))

const fetchJsonMock = vi.hoisted(() => (
  vi.fn(async (_url: string, options: { body: string }) => {
    const body = JSON.parse(options.body) as { target?: string, target_lang?: string }
    return { data: body.target_lang, target_text: body.target }
  })
))

vi.mock('@/config', () => ({ Config: configMock }))
vi.mock('@/services/http', () => ({ fetchJson: fetchJsonMock }))

import { translateText } from '@/translate/service'

describe('translateText target routing', () => {
  beforeEach(() => {
    fetchJsonMock.mockClear()
  })

  it('sends regular targets through DeepLX first', async () => {
    await translateText('你好', 'en')

    expect(fetchJsonMock).toHaveBeenCalledTimes(1)
    expect(fetchJsonMock.mock.calls[0][0]).toBe('https://deeplx.test/translate')
    expect(JSON.parse(fetchJsonMock.mock.calls[0][1].body).target_lang).toBe('EN')
  })

  it('skips DeepLX for wyw and posts straight to the tencent endpoint', async () => {
    // DeepL 语言表没有 WYW，直接请求只会白失败一次再走兜底。
    await translateText('你好', 'wyw')

    expect(fetchJsonMock).toHaveBeenCalledTimes(1)
    expect(fetchJsonMock.mock.calls[0][0]).toBe('https://tencent.test/translate')
    expect(JSON.parse(fetchJsonMock.mock.calls[0][1].body).target).toBe('wyw')
  })
})
