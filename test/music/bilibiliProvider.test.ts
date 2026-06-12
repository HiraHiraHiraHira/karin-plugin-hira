import { describe, expect, it } from 'vitest'

import { BilibiliMusicProvider, selectBilibiliAudio } from '@/music/providers/bilibili'

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
  it('searches with the signed app API and maps bilibili video items', async () => {
    const requests: string[] = []
    const provider = new BilibiliMusicProvider({
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
