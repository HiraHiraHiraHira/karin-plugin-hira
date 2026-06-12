import { describe, expect, it } from 'vitest'

import { extractKuaishouVideoId, normalizeKuaishouUrl } from '@/resolvers/kuaishou'

describe('kuaishou resolver helpers', () => {
  it('extracts ids from supported Kuaishou URL shapes', () => {
    expect(extractKuaishouVideoId('https://www.kuaishou.com/short-video/3xabc?authorId=1')).toBe('3xabc')
    expect(extractKuaishouVideoId('https://v.m.chenzhongtech.com/fw/photo/3xphoto')).toBe('3xphoto')
    expect(extractKuaishouVideoId('https://v.m.chenzhongtech.com/fw/long-video/3xlong')).toBe('3xlong')
  })

  it('normalizes ids to canonical short-video URLs', async () => {
    await expect(normalizeKuaishouUrl('https://www.kuaishou.com/short-video/3xabc')).resolves.toBe('https://www.kuaishou.com/short-video/3xabc')
  })

  it('expands short links before normalizing', async () => {
    await expect(normalizeKuaishouUrl(
      'https://v.kuaishou.com/abc',
      async () => 'https://www.kuaishou.com/short-video/3xexpanded?shareId=1'
    )).resolves.toBe('https://www.kuaishou.com/short-video/3xexpanded')
  })
})
