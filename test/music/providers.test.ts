import { describe, expect, it } from 'vitest'

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
    expect(() => requirePlayableUrl('')).toThrow('empty playable URL')
  })
})
