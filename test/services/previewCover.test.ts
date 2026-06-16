import { describe, expect, it, vi } from 'vitest'

import { inlinePreviewCover } from '@/services/previewCover'

describe('inlinePreviewCover', () => {
  it('downloads Weibo preview cover with referer and converts it to a data url', async () => {
    const fetcher = vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), {
      headers: { 'content-type': 'image/jpeg' },
      status: 200
    }))

    const post = await inlinePreviewCover({
      platform: 'weibo',
      displayName: '微博',
      title: '微博标题',
      pageUrl: 'https://weibo.com/1886633831/R47877p8L',
      videos: [],
      images: ['https://wx2.sinaimg.cn/mw2000/a.jpg']
    }, fetcher)

    expect(fetcher).toHaveBeenCalledWith('https://wx2.sinaimg.cn/mw2000/a.jpg', expect.objectContaining({
      headers: expect.objectContaining({ Referer: 'https://weibo.com/' })
    }))
    expect(post.extras?.coverUrl).toBe('data:image/jpeg;base64,AQID')
    expect(post.images).toEqual(['https://wx2.sinaimg.cn/mw2000/a.jpg'])
  })
})
