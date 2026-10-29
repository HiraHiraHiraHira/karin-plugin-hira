import { describe, expect, it } from 'vitest'

import { BilibiliMusicProvider, extractBvFromText } from '@/music/providers'
import { formatArtists, normalizeDuration, requirePlayableUrl } from '@/music/providers/helpers'

describe('music provider helpers', () => {
  it('formats artists consistently', () => {
    expect(formatArtists(['周杰伦', '方文山'])).toBe('周杰伦 / 方文山')
    expect(formatArtists([])).toBe('未知歌手')
  })

  it('normalizes millisecond and mm:ss durations', () => {
    expect(normalizeDuration(183000)).toBe(183)
    expect(normalizeDuration('03:05')).toBe(185)
    expect(normalizeDuration('01:02:03')).toBe(3723)
    expect(normalizeDuration(undefined)).toBeUndefined()
  })

  it('rejects empty playable URLs', () => {
    expect(requirePlayableUrl('https://example.test/a.mp3')).toBe('https://example.test/a.mp3')
    expect(() => requirePlayableUrl('')).toThrow('没有拿到可播放的音频链接')
  })
})

describe('Bilibili music link handling', () => {
  it('extracts BV ids from links, short text params, and rejects links without one', () => {
    expect(extractBvFromText('https://www.bilibili.com/video/BV1xx411c7mD?spm_id_from=333')).toBe('BV1xx411c7mD')
    expect(extractBvFromText('bilibili://video/BV1xx411c7mD')).toBe('BV1xx411c7mD')
    expect(extractBvFromText('https://b23.tv/abcdef')).toBeUndefined()
  })

  it('fails loudly instead of pretending an unresolvable link is playable', async () => {
    const provider = new BilibiliMusicProvider({ appKey: 'k', appSecret: 's' })
    await expect(provider.fromLink('https://b23.tv/abcdef')).rejects.toThrow('BV')
  })
})
