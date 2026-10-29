import { beforeEach, describe, expect, it, vi } from 'vitest'

import { getCatImages, queryMedicine, querySoftware } from '@/light/service'

const configMock = vi.hoisted(() => ({
  light: {
    enabled: true,
    catApis: [] as string[],
    buyerShowApis: [] as string[],
    tiredApis: [] as string[],
    medicineApi: '',
    softwareApi: ''
  }
}))

const httpMock = vi.hoisted(() => ({
  fetchJson: vi.fn()
}))

vi.mock('@/config', () => ({ Config: configMock }))
vi.mock('@/services/http', () => httpMock)

describe('getCatImages', () => {
  beforeEach(() => {
    httpMock.fetchJson.mockReset()
    configMock.light.catApis = []
  })

  it('把各图源的张数参数改写成 limit 后并发请求，并去重截断', async () => {
    configMock.light.catApis = [
      'https://shibe.test/api/cats?count=1',
      'https://thecat.test/v1/images/search?limit=1'
    ]
    httpMock.fetchJson.mockImplementation(async (url: string) => {
      if (url.includes('shibe.test')) {
        return ['https://img.test/a.png', 'https://img.test/b.png', 'https://img.test/a.png']
      }
      return [{ url: 'https://img.test/b.png' }, { url: 'https://img.test/c.png' }]
    })

    await expect(getCatImages(2)).resolves.toEqual(['https://img.test/a.png', 'https://img.test/b.png'])

    const requested = httpMock.fetchJson.mock.calls.map(call => new URL(String(call[0])))
    expect(requested).toHaveLength(2)
    expect(requested[0].searchParams.get('count')).toBe('2')
    expect(requested[1].searchParams.get('limit')).toBe('2')
  })

  it('配置里没有 count/limit 或不是合法 URL 时原样请求，单个源失败不影响其余源', async () => {
    configMock.light.catApis = ['https://plain.test/cat', 'not-a-url']
    httpMock.fetchJson.mockImplementation(async (url: string) => {
      if (url === 'https://plain.test/cat') return ['https://img.test/only.png']
      throw new Error('fetch failed')
    })

    await expect(getCatImages(10)).resolves.toEqual(['https://img.test/only.png'])

    expect(httpMock.fetchJson.mock.calls.map(call => String(call[0]))).toEqual([
      'https://plain.test/cat',
      'not-a-url'
    ])
  })
})

describe('querySoftware', () => {
  beforeEach(() => {
    httpMock.fetchJson.mockReset()
    configMock.light.softwareApi = ''
  })

  it('softwareApi 留空时使用内置 ghxi 源并本地按关键词过滤', async () => {
    httpMock.fetchJson.mockImplementation(async (url: string) => {
      if (url.endsWith('n=pc')) {
        return {
          data: [
            { title: '微信 v3.9 官方版', url: 'https://ghxi.test/wechat' },
            { title: 'QQ v9.9', url: 'https://ghxi.test/qq' }
          ]
        }
      }
      return { data: { list: [{ softName: '微信电脑版', introduction: '聊天工具' }] } }
    })

    const result = await querySoftware('微信')

    expect(result).toMatchObject({ type: 'text', title: '推荐软件' })
    if (result.type !== 'text') throw new Error('期望文本结果')
    expect(result.text).toContain('微信 v3.9 官方版')
    expect(result.text).toContain('微信电脑版')
    expect(result.text).not.toContain('QQ')
    expect(result.text).not.toContain('未找到')
  })

  it('无命中时回前 5 条并带明确提示', async () => {
    httpMock.fetchJson.mockImplementation(async () => ({
      data: Array.from({ length: 7 }, (_, index) => ({ title: `不相干软件 ${index + 1}` }))
    }))

    const result = await querySoftware('微信')

    if (result.type !== 'text') throw new Error('期望文本结果')
    const lines = result.text.split('\n')
    expect(lines[0]).toBe('未找到与「微信」相关的软件，以下是最近更新：')
    expect(result.text).toContain('不相干软件 1')
    expect(result.text).toContain('不相干软件 5')
    expect(result.text).not.toContain('不相干软件 6')
  })

  it('softwareApi 非空时交给配置的服务端搜索', async () => {
    configMock.light.softwareApi = 'https://search.test/soft?q={keyword}'
    httpMock.fetchJson.mockResolvedValue({ data: [{ title: '微信 v3.9 官方版' }] })

    const result = await querySoftware('微信')

    expect(httpMock.fetchJson).toHaveBeenCalledTimes(1)
    expect(String(httpMock.fetchJson.mock.calls[0][0])).toBe('https://search.test/soft?q=%E5%BE%AE%E4%BF%A1')
    if (result.type !== 'text') throw new Error('期望文本结果')
    expect(result.text).toContain('微信 v3.9 官方版')
  })
})

describe('queryMedicine', () => {
  beforeEach(() => {
    httpMock.fetchJson.mockReset()
  })

  it('使用配置的医药源，仅对 dayi 关闭证书校验', async () => {
    configMock.light.medicineApi = 'https://server.dayi.org.cn/api/search?keyword={keyword}&pageNo=1&pageSize=10'
    httpMock.fetchJson.mockResolvedValue({
      list: [{ title: '阿莫西林', secondTitle: '胶囊', introduction: '抗生素' }]
    })

    const result = await queryMedicine('阿莫西林')

    const [url, options] = httpMock.fetchJson.mock.calls[0]
    expect(String(url)).toBe('https://server.dayi.org.cn/api/search?keyword=%E9%98%BF%E8%8E%AB%E8%A5%BF%E6%9E%97&pageNo=1&pageSize=10')
    expect(options).toEqual({ insecure: true })
    if (result.type !== 'text') throw new Error('期望文本结果')
    expect(result.text).toContain('阿莫西林 - 胶囊')
  })

  it('其他 host 正常校验证书，非 dayi 结构回落到通用列表解析', async () => {
    configMock.light.medicineApi = 'https://drug.test/api?keyword={keyword}'
    httpMock.fetchJson.mockResolvedValue({ data: [{ title: '布洛芬', description: '解热镇痛' }] })

    const result = await queryMedicine('布洛芬')

    const [url, options] = httpMock.fetchJson.mock.calls[0]
    expect(String(url)).toBe('https://drug.test/api?keyword=%E5%B8%83%E6%B4%9B%E8%8A%AC')
    expect(options).toEqual({})
    if (result.type !== 'text') throw new Error('期望文本结果')
    expect(result.text).toContain('布洛芬')
  })
})
