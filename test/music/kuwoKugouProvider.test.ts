import { describe, expect, it } from 'vitest'

import { KugouProvider } from '@/music/providers/kugou'
import { KuwoProvider } from '@/music/providers/kuwo'

describe('KuwoProvider lyrics', () => {
  it('normalizes lyric lines', async () => {
    const provider = new KuwoProvider({
      fetchJson: async <T = unknown>() => ({
        data: {
          lrclist: [
            { lineLyric: '第一句' },
            { lineLyric: '第二句' }
          ]
        }
      }) as T
    })

    expect(await provider.getLyrics?.({
      id: '1',
      source: 'kuwo',
      title: '歌',
      artists: [],
      pageUrl: 'https://www.kuwo.cn/play_detail/1'
    })).toBe('第一句\n第二句')
  })
})

describe('KuwoProvider playable fallback', () => {
  const item = {
    id: '228908',
    source: 'kuwo' as const,
    title: '青花',
    artists: ['周传雄'],
    pageUrl: 'https://www.kuwo.cn/play_detail/228908'
  }

  it('falls back to antiserver convert_url3 when the playUrl API fails', async () => {
    const calls: string[] = []
    const provider = new KuwoProvider({
      fetchJson: async <T = unknown>(url: string) => {
        calls.push(url)
        if (url.includes('/playUrl')) throw new Error('500')
        return { url: 'http://antiserver.kuwo.cn/resource/a.mp3' } as T
      }
    })

    await expect(provider.getPlayable(item)).resolves.toMatchObject({
      audioUrl: 'http://antiserver.kuwo.cn/resource/a.mp3'
    })
    expect(calls[0]).toContain('/playUrl')
    expect(calls[1]).toContain('convert_url3')
    expect(calls[1]).toContain('rid=228908')
  })

  it('reads url from the playUrl response when available', async () => {
    const provider = new KuwoProvider({
      fetchJson: async <T = unknown>() => ({ data: { url: 'https://kuwo.example.test/a.mp3' } }) as T
    })

    await expect(provider.getPlayable(item)).resolves.toMatchObject({
      audioUrl: 'https://kuwo.example.test/a.mp3'
    })
  })

  it('reports the source name when no playable url is found', async () => {
    const provider = new KuwoProvider({
      fetchJson: async <T = unknown>(url: string) => {
        if (url.includes('/playUrl')) throw new Error('500')
        return {} as T
      }
    })

    await expect(provider.getPlayable(item)).rejects.toThrow('酷我：未获取到')
  })
})

describe('KugouProvider lyrics', () => {
  it('returns lyrics from play info', async () => {
    const provider = new KugouProvider({
      fetchJson: async <T = unknown>() => ({ lyrics: '[00:00]歌词' }) as T
    })

    expect(await provider.getLyrics?.({
      id: 'hash',
      source: 'kugou',
      title: '歌',
      artists: [],
      pageUrl: 'https://www.kugou.com/song/#hash=hash'
    })).toBe('[00:00]歌词')
  })
})
