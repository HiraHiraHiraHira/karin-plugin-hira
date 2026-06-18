import { afterEach, describe, expect, it, vi } from 'vitest'

import { extractKuaishouVideoId, normalizeKuaishouUrl, resolveKuaishou } from '@/resolvers/kuaishou'

describe('kuaishou resolver helpers', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

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

  it('resolves through general APIs while preserving the Kuaishou platform and canonical source url', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      expect(url).toContain(encodeURIComponent('https://www.kuaishou.com/short-video/3xabc'))
      return new Response(JSON.stringify({
        data: {
          title: '快手标题',
          desc: '快手正文',
          author: '作者',
          coverUrl: 'https://img.example.test/cover.jpg',
          url: 'https://cdn.example.test/video.mp4'
        }
      }), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await resolveKuaishou('https://www.kuaishou.com/short-video/3xabc', [
      'https://api.example.test/parse?url={url}'
    ])

    expect(result).toMatchObject({
      platform: 'kuaishou',
      displayName: '快手',
      title: '快手标题',
      description: '快手正文',
      author: '作者',
      pageUrl: 'https://www.kuaishou.com/short-video/3xabc',
      videos: ['https://cdn.example.test/video.mp4'],
      images: ['https://img.example.test/cover.jpg'],
      extras: {
        coverUrl: 'https://img.example.test/cover.jpg',
        contentBlocks: [
          { type: 'text', text: '快手正文' },
          { type: 'image', url: 'https://img.example.test/cover.jpg' }
        ]
      }
    })
  })
})
