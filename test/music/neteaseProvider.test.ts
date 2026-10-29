import { beforeEach, describe, expect, it, vi } from 'vitest'

import { NeteaseProvider, buildNeteaseHighQualityRequest, normalizeNeteaseCookieStatus } from '@/music/providers/netease'
import type { FetchJsonOptions, fetchJson } from '@/services/http'

// 直链探测会真的发 HEAD 请求，测试里替换掉，避免依赖外网
const probe = vi.hoisted(() => ({ playable: true }))

vi.mock('@/services/http', async importOriginal => {
  const actual = await importOriginal<typeof import('@/services/http')>()
  return {
    ...actual,
    fetchResponse: async () => ({
      ok: probe.playable,
      headers: new Headers({ 'content-type': probe.playable ? 'audio/mpeg' : 'text/html;charset=utf8' })
    }) as unknown as Response
  }
})

describe('Netease provider helpers', () => {
  beforeEach(() => {
    probe.playable = true
  })

  it('uses xiaofei-compatible cloudsearch pc endpoint for music.163.com api base', async () => {
    const calls: Array<{ url: string, method?: string, body?: BodyInit }> = []
    const requestJson: typeof fetchJson = async <T = unknown>(url: string, options: FetchJsonOptions = {}) => {
      calls.push({ url, method: options.method, body: options.body })
      return {
        result: {
          songs: [{
            id: 123,
            name: '青花',
            artists: [{ name: '周传雄' }],
            duration: 297506
          }]
        }
      } as T
    }
    const provider = new NeteaseProvider({
      baseUrl: 'https://music.163.com/api',
      fetchJson: requestJson
    })

    await expect(provider.search('青花', 1, 10)).resolves.toHaveLength(1)
    expect(calls[0].url).toBe('https://music.163.com/api/cloudsearch/pc')
    expect(calls[0].method).toBe('POST')
    expect(String(calls[0].body)).toContain('s=%E9%9D%92%E8%8A%B1')
    expect(String(calls[0].body)).toContain('limit=10')
    expect(String(calls[0].body)).toContain('offset=0')
  })

  it('uses xiaofei-compatible outer media url for music.163.com api base playback fallback', async () => {
    const provider = new NeteaseProvider({
      baseUrl: 'https://music.163.com/api',
      fetchJson: async () => {
        throw new Error('should not call song/url endpoint for official api base')
      }
    })

    await expect(provider.getPlayable({
      id: '123',
      source: 'netease',
      title: '青花',
      artists: ['周传雄'],
      pageUrl: 'http://music.163.com/#/song?id=123'
    })).resolves.toMatchObject({
      audioUrl: 'https://music.163.com/song/media/outer/url?id=123'
    })
  })

  it('会员歌直链校验没过时优先试聚合音源，仍拿不到也不报错（平台卡片不需要直链）', async () => {
    probe.playable = false
    const provider = new NeteaseProvider({
      baseUrl: 'https://music.163.com/api',
      fetchJson: async () => {
        throw new Error('aggregator down')
      }
    })

    await expect(provider.getPlayable({
      id: '186016',
      source: 'netease',
      title: '晴天',
      artists: ['周杰伦'],
      pageUrl: 'https://music.163.com/#/song?id=186016',
      raw: { fee: 1 }
    })).resolves.toMatchObject({
      audioUrl: 'https://music.163.com/song/media/outer/url?id=186016'
    })
  })

  it('builds high quality request with MUSIC_U endpoint', () => {
    expect(buildNeteaseHighQualityRequest('123')).toEqual({
      url: 'https://interface3.music.163.com/api/song/enhance/player/url/v1',
      body: 'ids=%5B123%5D&level=exhigh&encodeType=mp3'
    })
  })

  it('normalizes cookie status', () => {
    expect(normalizeNeteaseCookieStatus({ code: 200, profile: { nickname: 'Hira' } })).toEqual({
      ok: true,
      message: 'Hira'
    })
    expect(normalizeNeteaseCookieStatus({ code: 301 })).toEqual({
      ok: false,
      message: 'Cookie 失效或未登录'
    })
  })
})

describe('Netease quality level', () => {
  it('requests lossless when music.highQuality is enabled and exhigh otherwise', async () => {
    const levels: string[] = []
    const requestJson: typeof fetchJson = async <T = unknown>(url: string) => {
      const level = new URL(decodeURIComponent(String(url))).searchParams.get('level')
      // 聚合音源也会走这个 requestJson，这里只记录原生播放接口的档位，避免把兜底搜索算进来
      if (level) levels.push(level)
      return { data: [{ url: 'https://cdn.example.test/a.mp3', level: 'x' }] } as T
    }
    const item = { id: '1', source: 'netease' as const, title: 't', artists: [], pageUrl: 'https://music.163.com/#/song?id=1' }

    await new NeteaseProvider({ baseUrl: 'https://api.example.test', highQuality: false, fetchJson: requestJson }).getPlayable(item)
    await new NeteaseProvider({ baseUrl: 'https://api.example.test', highQuality: true, fetchJson: requestJson }).getPlayable(item)

    expect(levels).toEqual(['exhigh', 'lossless'])
  })
})
