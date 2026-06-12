import { describe, expect, it } from 'vitest'

import { NeteaseProvider, buildNeteaseHighQualityRequest, normalizeNeteaseCookieStatus } from '@/music/providers/netease'
import type { FetchJsonOptions, fetchJson } from '@/services/http'

describe('Netease provider helpers', () => {
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
      baseUrl: 'http://music.163.com/api',
      fetchJson: requestJson
    })

    await expect(provider.search('青花', 1, 10)).resolves.toHaveLength(1)
    expect(calls[0].url).toBe('http://music.163.com/api/cloudsearch/pc')
    expect(calls[0].method).toBe('POST')
    expect(String(calls[0].body)).toContain('s=%E9%9D%92%E8%8A%B1')
    expect(String(calls[0].body)).toContain('limit=10')
    expect(String(calls[0].body)).toContain('offset=0')
  })

  it('uses xiaofei-compatible outer media url for music.163.com api base playback fallback', async () => {
    const provider = new NeteaseProvider({
      baseUrl: 'http://music.163.com/api',
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
      audioUrl: 'http://music.163.com/song/media/outer/url?id=123'
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
