import { beforeEach, describe, expect, it, vi } from 'vitest'

// 翻译服务按 target 决定走 DeepLX 还是腾讯 transmart 兼容接口，这里验证路由与请求体。
const configMock = vi.hoisted(() => ({
  translate: {
    timeoutSeconds: 5,
    deeplxApi: '',
    tencentApi: 'https://transmart.test/api/imt'
  }
}))

const fetchJsonMock = vi.hoisted(() => vi.fn())

vi.mock('@/config', () => ({ Config: configMock }))
vi.mock('@/services/http', () => ({ fetchJson: fetchJsonMock }))

import { resolveDeeplxUrls, translateText } from '@/translate/service'

const transmartMock = () => fetchJsonMock.mockImplementation(async (url: string, options: { body: string }) => {
  const body = JSON.parse(options.body) as {
    header?: { fn?: string }
    text?: string
    source?: { lang?: string, text_list?: string[] }
    target?: { lang?: string }
  }
  if (url !== 'https://transmart.test/api/imt') throw new Error('HTTP 401')
  if (body.header?.fn === 'text_analysis') {
    return { header: { ret_code: 'succ' }, language: 'zh' }
  }
  const source = body.source?.text_list?.[1] ?? ''
  return {
    header: { ret_code: 'succ' },
    auto_translation: ['', `译文:${source}->${body.target?.lang}`, '']
  }
})

const bodyOf = (call: unknown[]) => JSON.parse(String((call[1] as { body: string }).body))

describe('translateText transmart protocol', () => {
  beforeEach(() => {
    fetchJsonMock.mockReset()
    configMock.translate.deeplxApi = ''
    configMock.translate.tencentApi = 'https://transmart.test/api/imt'
  })

  it('未配置 deeplx 时先 text_analysis 探测语言，再按 R trans-strategy 结构请求 auto_translation', async () => {
    transmartMock()

    await expect(translateText('你好', 'en')).resolves.toBe('译文:你好->en')

    expect(fetchJsonMock).toHaveBeenCalledTimes(2)
    const analysis = bodyOf(fetchJsonMock.mock.calls[0])
    expect(analysis.header.fn).toBe('text_analysis')
    expect(analysis.header.client_key).toContain('browser-firefox')
    expect(analysis.text).toBe('你好')
    expect(analysis.type).toBe('plain')
    expect(analysis.normalize).toEqual({ merge_broken_line: false })

    const translation = bodyOf(fetchJsonMock.mock.calls[1])
    expect(translation.header.fn).toBe('auto_translation')
    expect(translation.type).toBe('plain')
    expect(translation.model_category).toBe('normal')
    expect(translation.text_domain).toBe('general')
    // R 用首尾空串占位，译文固定取下标 1
    expect(translation.source).toEqual({ lang: 'zh', text_list: ['', '你好', ''] })
    expect(translation.target).toEqual({ lang: 'en' })
  })

  it('deeplxApi 支持逗号分隔多镜像并随机选一个', async () => {
    configMock.translate.deeplxApi = 'https://deeplx-a.test/translate, https://deeplx-b.test/translate'
    expect(resolveDeeplxUrls(configMock.translate.deeplxApi)).toEqual([
      'https://deeplx-a.test/translate',
      'https://deeplx-b.test/translate'
    ])

    fetchJsonMock.mockImplementation(async (url: string, options: { body: string }) => {
      const body = JSON.parse(options.body) as { header?: { fn?: string }, target_lang?: string, source_lang?: string }
      if (url === 'https://transmart.test/api/imt') {
        return { header: { ret_code: 'succ' }, language: 'zh' }
      }
      expect(body.source_lang).toBe('ZH')
      return { data: `deepl:${body.target_lang}` }
    })

    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.75)
    await expect(translateText('你好', 'ja')).resolves.toBe('deepl:JA')
    randomSpy.mockReturnValue(0)
    await expect(translateText('你好', 'ja')).resolves.toBe('deepl:JA')

    const usedUrls = fetchJsonMock.mock.calls.map(call => String(call[0]))
    expect(usedUrls).toEqual([
      'https://transmart.test/api/imt',
      'https://deeplx-b.test/translate',
      'https://transmart.test/api/imt',
      'https://deeplx-a.test/translate'
    ])
    randomSpy.mockRestore()
  })

  it('DeepLX 失败后降级到 transmart，两边都失败时给出配置/用法提示', async () => {
    configMock.translate.deeplxApi = 'https://deeplx.test/fail'
    fetchJsonMock.mockImplementation(async (url: string, options: { body: string }) => {
      if (url === 'https://deeplx.test/fail') throw new Error('HTTP 401')
      const body = JSON.parse(options.body) as { header?: { fn?: string } }
      if (body.header?.fn === 'text_analysis') return { header: { ret_code: 'succ' }, language: 'zh' }
      return { header: { ret_code: 'succ' }, auto_translation: ['', '兜底译文', ''] }
    })

    await expect(translateText('你好', 'en')).resolves.toBe('兜底译文')

    fetchJsonMock.mockReset()
    fetchJsonMock.mockRejectedValue(new Error('HTTP 401'))
    const failure = translateText('你好', 'en')
    await expect(failure).rejects.toThrow(/translate\.yaml/)
    await expect(failure).rejects.toThrow(/用法：翻中 hello/)
  })

  it('腾讯接口返回非 succ 时按失败处理', async () => {
    fetchJsonMock.mockImplementation(async (_url: string, options: { body: string }) => {
      const body = JSON.parse(options.body) as { header?: { fn?: string } }
      if (body.header?.fn === 'text_analysis') return { header: { ret_code: 'succ' }, language: 'zh' }
      return { header: { ret_code: 'unsupported_lang' }, auto_translation: [''] }
    })

    await expect(translateText('你好', 'en')).rejects.toThrow(/unsupported_lang/)
  })

  it('文言文目标不可用时不发任何请求，直接给出可读提示', async () => {
    // transmart 实测返回 Unrecognized target language: wyw；DeepLX 也没有该语言。
    configMock.translate.deeplxApi = 'https://deeplx.test/translate'

    await expect(translateText('你好', 'wyw')).rejects.toThrow(/暂不支持翻译为文言文/)

    expect(fetchJsonMock).not.toHaveBeenCalled()
  })
})
