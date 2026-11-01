import { describe, expect, it } from 'vitest'

import { BilibiliMusicProvider, selectBilibiliAudio, toPlayableBilibiliUrl } from '@/music/providers/bilibili'

describe('toPlayableBilibiliUrl（对齐小飞的镜像改写）', () => {
  it('把 IP 型直链换成 bilivideo 镜像域名', () => {
    expect(toPlayableBilibiliUrl('http://123.45.67.89/upgcxcode/a.m4s'))
      .toBe('https://upos-sz-mirrorhw.bilivideo.com/upgcxcode/a.m4s')
  })

  it('base_url 不是 IP 时优先用 IP 型的 backup_url', () => {
    expect(toPlayableBilibiliUrl('http://cdn.example.test/a.m4s', ['http://10.0.0.1/a.m4s']))
      .toBe('https://upos-sz-mirrorhw.bilivideo.com/a.m4s')
  })

  it('都不是 IP 型时保持原样', () => {
    expect(toPlayableBilibiliUrl('https://upos-sz-mirrorcosov.bilivideo.com/a.m4s'))
      .toBe('https://upos-sz-mirrorcosov.bilivideo.com/a.m4s')
  })
})

describe('selectBilibiliAudio', () => {
  it('selects the highest quality dash audio URL', () => {
    expect(selectBilibiliAudio({
      data: {
        dash: {
          audio: [
            { id: 30216, baseUrl: 'https://low.example.test/audio.m4s' },
            { id: 30280, base_url: 'https://high.example.test/audio.m4s' }
          ]
        }
      }
    })).toEqual({
      id: 30280,
      url: 'https://high.example.test/audio.m4s'
    })
  })

  it('returns undefined when no audio stream exists', () => {
    expect(selectBilibiliAudio({ data: { dash: { audio: [] } } })).toBeUndefined()
  })
})

describe('BilibiliMusicProvider getPlayable', () => {
  it('fails clearly when app credentials are missing', async () => {
    const previousAppKey = process.env.HIRA_BILIBILI_APP_KEY
    const previousAppSecret = process.env.HIRA_BILIBILI_APP_SECRET
    delete process.env.HIRA_BILIBILI_APP_KEY
    delete process.env.HIRA_BILIBILI_APP_SECRET

    try {
      const provider = new BilibiliMusicProvider()
      await expect(provider.search('测试', 1, 1)).rejects.toThrow('music.bilibili.appKey')
    } finally {
      if (previousAppKey === undefined) delete process.env.HIRA_BILIBILI_APP_KEY
      else process.env.HIRA_BILIBILI_APP_KEY = previousAppKey
      if (previousAppSecret === undefined) delete process.env.HIRA_BILIBILI_APP_SECRET
      else process.env.HIRA_BILIBILI_APP_SECRET = previousAppSecret
    }
  })

  it('searches with the signed app API and maps bilibili video items', async () => {
    const requests: string[] = []
    const provider = new BilibiliMusicProvider({
      appKey: 'test-app-key',
      appSecret: 'test-app-secret',
      fetchJson: async (url) => {
        requests.push(url)
        return {
          data: {
            items: [{
              title: '<em class="keyword">青花瓷</em> 翻唱',
              author: '<em>UP</em>主',
              cover: '//i0.hdslb.com/bfs/archive/cover.jpg',
              duration: 123,
              share: {
                video: {
                  bvid: 'BV14A31eZEH8',
                  short_link: 'https://b23.tv/BV14A31eZEH8'
                }
              }
            }]
          }
        } as any
      }
    })

    const items = await provider.search('青花瓷', 2, 5)

    expect(requests[0]).toContain('https://app.bilibili.com/x/v2/search/type?')
    expect(requests[0]).toContain('keyword=%E9%9D%92%E8%8A%B1%E7%93%B7')
    expect(requests[0]).toContain('pn=2')
    expect(requests[0]).toContain('ps=5')
    expect(requests[0]).toContain('sign=')
    expect(items).toEqual([{
      id: 'BV14A31eZEH8',
      source: 'bilibili',
      title: '青花瓷 翻唱',
      artists: ['UP主'],
      durationSeconds: 123,
      coverUrl: 'https://i0.hdslb.com/bfs/archive/cover.jpg',
      pageUrl: 'https://b23.tv/BV14A31eZEH8',
      raw: expect.any(Object)
    }])
  })

  it('resolves cid when needed and builds a signed tv playable URL', async () => {
    const requests: string[] = []
    const options: unknown[] = []
    const provider = new BilibiliMusicProvider({
      appKey: 'test-app-key',
      appSecret: 'test-app-secret',
      fetchJson: async (url, requestOptions) => {
        requests.push(url)
        options.push(requestOptions)
        if (url.includes('/x/web-interface/view')) {
          return {
            data: {
              aid: 123,
              bvid: 'BV14A31eZEH8',
              cid: 456,
              title: '测试视频',
              owner: { name: 'UP' }
            }
          } as any
        }

        return {
          data: {
            dash: {
              audio: [{ id: 30280, base_url: 'https://audio.example.test/a.m4s' }]
            }
          }
        } as any
      }
    })

    const playable = await provider.getPlayable({
      id: 'BV14A31eZEH8',
      source: 'bilibili',
      title: '测试视频',
      artists: ['UP'],
      pageUrl: 'https://www.bilibili.com/video/BV14A31eZEH8'
    })

    expect(playable.audioUrl).toBe('https://audio.example.test/a.m4s')
    expect(playable.quality).toBe('30280')
    expect(requests[0]).toContain('/x/web-interface/view?bvid=BV14A31eZEH8')
    expect(requests[1]).toContain('https://api.bilibili.com/x/tv/playurl?')
    expect(requests[1]).toContain('object_id=123')
    expect(requests[1]).toContain('cid=456')
    expect(requests[1]).toContain('sign=')
    expect(options[1]).toEqual({ defaultHeaders: false })
  })
})
