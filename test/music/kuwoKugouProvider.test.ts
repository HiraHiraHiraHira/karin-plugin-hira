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
