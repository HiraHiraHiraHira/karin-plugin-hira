import { describe, expect, it } from 'vitest'

import { QQProvider, buildQQVkeyFilenames, decodeQQLyric, normalizeQQSearchResult, parseQQCookieUin, pickQQPlayableUrl } from '@/music/providers/qq'
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

  it('checks cookie status with QQ profile endpoint and reports VIP', async () => {
    const calls: Array<{ url: string, cookie?: string }> = []
    const checkFetch: typeof fetchJson = async <T = unknown>(url: string, options: FetchJsonOptions = {}) => {
      calls.push({ url, cookie: options?.headers?.Cookie })
      if (url.includes('musicu.fcg')) {
        return {
          req_0: {
            code: '0',
            data: { infoMap: { '10001': { iVipFlag: 1 } } }
          }
        } as T
      }
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
      message: 'Hira',
      vip: true
    })
    expect(calls[0].url).toContain('fcg_get_profile_homepage.fcg')
    expect(calls[0].cookie).toBe('uin=10001; qm_keyst=secret')
  })

  it('reports a clear error instead of fabricating songs when every search channel fails', async () => {
    const provider = new QQProvider({
      fetchJson: async () => { throw new Error('network down') }
    })

    await expect(provider.search('青花', 1, 20)).rejects.toThrow('QQ音乐搜索暂时不可用')
  })

  it('requests the full quality ladder with media_mid and falls back to M800', () => {
    expect(buildQQVkeyFilenames('songmid', {
      media_mid: 'mediamid',
      size_320mp3: 1,
      size_192ogg: 1,
      size_128mp3: 1,
      size_96aac: 1
    })).toEqual([
      'M800mediamid.mp3',
      'O600mediamid.ogg',
      'M500mediamid.mp3',
      'C400mediamid.m4a'
    ])
    expect(buildQQVkeyFilenames('songmid', { size_128mp3: 1 })).toEqual(['M500songmid.mp3'])
    expect(buildQQVkeyFilenames('songmid')).toEqual(['M800songmid.mp3'])
  })

  it('parses uin from QQ and wechat cookies', () => {
    expect(parseQQCookieUin('uin=10001; qm_keyst=secret')).toBe('10001')
    expect(parseQQCookieUin('wxuin=20002; qm_keyst=secret')).toBe('20002')
    expect(parseQQCookieUin('qm_keyst=secret')).toBeUndefined()
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

  it('fetches favorites and daily recommendations through CgiGetDiss', async () => {
    const bodies: Array<Record<string, any>> = []
    const provider = new QQProvider({
      cookie: 'uin=10001; qm_keyst=secret',
      fetchJson: async <T = unknown>(_url: string, options?: FetchJsonOptions) => {
        bodies.push(JSON.parse(String(options?.body)))
        return {
          req_0: {
            code: '0',
            data: { songlist: [{ mid: 'm1', name: '收藏', singer: [{ name: 'A' }], interval: 60 }] }
          }
        } as T
      }
    })

    await expect(provider.getPersonalized('favorites', { page: 2, pageSize: 20 })).resolves.toMatchObject([{ id: 'm1', title: '收藏' }])
    await expect(provider.getPersonalized('dailyRecommend', { page: 2, pageSize: 30 })).resolves.toHaveLength(1)

    expect(bodies[0].req_0.module).toBe('srf_diss_info.DissInfoServer')
    expect(bodies[0].req_0.param.dirid).toBe(201)
    expect(bodies[0].req_0.param.song_begin).toBe(20)
    expect(bodies[0].comm.uin).toBe('10001')
    expect(bodies[1].req_0.param.dirid).toBe(202)
    expect(bodies[1].req_0.param.song_begin).toBe(30)
  })

  it('fetches the radio station with the requested size', async () => {
    const bodies: Array<Record<string, any>> = []
    const provider = new QQProvider({
      cookie: 'uin=10001; qm_keyst=secret',
      fetchJson: async <T = unknown>(_url: string, options?: FetchJsonOptions) => {
        bodies.push(JSON.parse(String(options?.body)))
        return { req_0: { code: '0', data: { tracks: [{ mid: 'r1', name: '电台', singer: [] }] } } } as T
      }
    })

    await expect(provider.getPersonalized('radio', { pageSize: 5 })).resolves.toHaveLength(1)
    expect(bodies[0].req_0.module).toBe('pc_track_radio_svr')
    expect(bodies[0].req_0.param.num).toBe(5)
  })

  it('picks one random song from the recommendation feed', async () => {
    const provider = new QQProvider({
      cookie: 'uin=10001; qm_keyst=secret',
      fetchJson: async <T = unknown>(_url: string, options?: FetchJsonOptions) => {
        const body = JSON.parse(String(options?.body)) as Record<string, any>
        if (body.req_0.method === 'get_recommend_feed') {
          return {
            req_0: {
              code: '0',
              data: {
                v_shelf: [
                  { style: 1, v_niche: [{ v_card: [{ id: 11 }, { id: 22 }] }] },
                  { style: 2, v_niche: [{ v_card: [{ id: 99 }] }] }
                ]
              }
            }
          } as T
        }
        return {
          req_0: { code: '0', data: { tracks: [{ mid: 'rec1', name: '推荐', singer: [] }] } }
        } as T
      }
    })

    await expect(provider.getPersonalized('random')).resolves.toHaveLength(1)
  })

  it('asks for a QQ cookie before personalized requests', async () => {
    const provider = new QQProvider({ fetchJson: async <T = unknown>() => ({}) as T })

    await expect(provider.getPersonalized('favorites')).rejects.toThrow('QQ音乐：我的收藏需要先配置 Cookie')
  })
})
