import { describe, expect, it } from 'vitest'

import { QQProvider, decodeQQLyric, normalizeQQSearchResult, pickQQPlayableUrl } from '@/music/providers/qq'
import type { FetchJsonOptions, fetchJson } from '@/services/http'

describe('QQProvider helpers', () => {
  it('normalizes official search results', () => {
    expect(normalizeQQSearchResult({
      req_1: {
        data: {
          body: {
            song: {
              list: [
                {
                  mid: 'songmid',
                  id: 123,
                  name: '晴天',
                  singer: [{ name: '周杰伦' }],
                  album: { name: '叶惠美', pmid: 'albumpmid' },
                  interval: 269
                }
              ]
            }
          }
        }
      }
    })).toMatchObject([
      {
        id: 'songmid',
        source: 'qq',
        title: '晴天',
        artists: ['周杰伦'],
        album: '叶惠美',
        durationSeconds: 269
      }
    ])
  })

  it('picks vkey playable url', () => {
    expect(pickQQPlayableUrl({
      req_0: {
        data: {
          sip: ['https://dl.stream.qqmusic.qq.com/'],
          midurlinfo: [{ purl: 'M800songmid.mp3?vkey=abc' }]
        }
      }
    })).toBe('https://dl.stream.qqmusic.qq.com/M800songmid.mp3?vkey=abc')
  })

  it('decodes base64 lyrics', () => {
    expect(decodeQQLyric(Buffer.from('歌词内容').toString('base64'))).toBe('歌词内容')
  })
})

describe('QQProvider', () => {
  it('uses official search when available', async () => {
    const provider = new QQProvider({
      fetchJson: async <T = unknown>() => ({
        req_1: {
          data: {
            body: {
              song: {
                list: [{ mid: 'm1', name: '歌', singer: [{ name: 'A' }], album: {}, interval: 1 }]
              }
            }
          }
        }
      }) as T
    })

    expect(await provider.search('歌', 1, 10)).toHaveLength(1)
  })

  it('checks cookie status with QQ profile endpoint', async () => {
    const calls: Array<{ url: string, cookie?: string }> = []
    const checkFetch: typeof fetchJson = async <T = unknown>(url: string, options: FetchJsonOptions = {}) => {
      calls.push({ url, cookie: options?.headers?.Cookie })
      return {
        code: 0,
        data: {
          creator: {
            nick: 'Hira'
          }
        }
      } as T
    }
    const provider = new QQProvider({
      cookie: 'uin=10001; qm_keyst=secret',
      fetchJson: checkFetch
    })

    await expect(provider.checkCookie()).resolves.toEqual({
      ok: true,
      message: 'Hira'
    })
    expect(calls[0].url).toContain('fcg_get_profile_homepage.fcg')
    expect(calls[0].cookie).toBe('uin=10001; qm_keyst=secret')
  })

  it('falls back to legacy QQ share music url when vkey and temp api are unavailable', async () => {
    const provider = new QQProvider({
      fetchJson: async <T = unknown>() => ({
        req_0: {
          data: {
            sip: ['http://aqqmusic.tc.qq.com/'],
            midurlinfo: [{ songmid: '002MFDAV3rPFlo', purl: '' }]
          }
        }
      }) as T
    })

    await expect(provider.getPlayable({
      id: '002MFDAV3rPFlo',
      source: 'qq',
      title: '青花',
      artists: ['周传雄'],
      pageUrl: 'https://y.qq.com/n/yqq/song/002MFDAV3rPFlo.html'
    })).resolves.toMatchObject({
      audioUrl: 'http://c6.y.qq.com/rsc/fcgi-bin/fcg_pyq_play.fcg?songid=&songmid=002MFDAV3rPFlo&songtype=1&fromtag=50&uin=0&code=23A6E'
    })
  })
})
