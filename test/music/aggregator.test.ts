import { beforeEach, describe, expect, it } from 'vitest'

import { aggregatorAudioUrl, aggregatorSearch, resetAggregatorCache } from '@/music/providers/aggregator'
import type { MusicItem } from '@/music/types'

type SearchRequest = Parameters<typeof aggregatorSearch>[4]
type AudioRequest = Parameters<typeof aggregatorAudioUrl>[1]

const fakeRequest = (payload: unknown) => (async () => payload) as unknown as SearchRequest

const item = (overrides: Partial<MusicItem> = {}): MusicItem => ({
  id: 'local',
  source: 'kugou',
  title: '青花瓷',
  artists: ['周杰伦'],
  pageUrl: 'https://example.com/song',
  ...overrides
})

describe('聚合音源（txqq.pro）', () => {
  beforeEach(() => {
    resetAggregatorCache()
  })

  it('搜索时丢掉没有音频直链的结果，避免发出坏卡', async () => {
    const items = await aggregatorSearch('kugou', '青花瓷', 1, 5, fakeRequest({
      data: [
        { songid: 'a', title: '青花瓷', author: '周杰伦', url: 'https://cdn/a.mp3', link: 'https://kugou/song/a' },
        { songid: 'b', title: '没有直链', author: '别人', url: null, link: 'https://kugou/song/b' }
      ]
    }))

    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      id: 'a',
      source: 'kugou',
      title: '青花瓷',
      artists: ['周杰伦'],
      pageUrl: 'https://kugou/song/a'
    })
    expect((items[0]!.raw as { aggregatorUrl?: string }).aggregatorUrl).toBe('https://cdn/a.mp3')
  })

  it('结果自带直链时直接用，不再发兜底查询', async () => {
    const failing = (async () => {
      throw new Error('不该发请求')
    }) as unknown as AudioRequest

    const cached = item({ raw: { aggregatorUrl: 'https://cdn/cached.mp3' } })
    await expect(aggregatorAudioUrl(cached, failing)).resolves.toBe('https://cdn/cached.mp3')
  })

  it('兜底查询要求标题完全一致，并优先歌手对得上的结果', async () => {
    const bodies: string[] = []
    const request = (async (_url: string, options?: { body?: string }) => {
      bodies.push(String(options?.body ?? ''))
      return {
        data: [
          { songid: 'cover', title: '青花瓷', author: '翻唱歌手', url: 'https://cdn/cover.mp3' },
          { songid: 'origin', title: '青花瓷', author: '周杰伦', url: 'https://cdn/origin.mp3' },
          { songid: 'live', title: '青花瓷（现场版）', author: '周杰伦', url: 'https://cdn/live.mp3' }
        ]
      }
    }) as unknown as AudioRequest

    await expect(aggregatorAudioUrl(item(), request)).resolves.toBe('https://cdn/origin.mp3')
    expect(bodies[0]).toContain('type=kugou')
    expect(new URLSearchParams(bodies[0]!).get('input')).toBe('青花瓷 周杰伦')
  })

  it('标题对不上时宁可返回空，也不给别的歌', async () => {
    const request = fakeRequest({
      data: [{ songid: 'other', title: '东风破', author: '周杰伦', url: 'https://cdn/other.mp3' }]
    }) as unknown as AudioRequest

    await expect(aggregatorAudioUrl(item(), request)).resolves.toBeUndefined()
  })
})
