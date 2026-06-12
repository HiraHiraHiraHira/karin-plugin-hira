import { describe, expect, it } from 'vitest'

import { extractXiaohongshuNoteId, normalizeXiaohongshuNote } from '@/resolvers/xiaohongshu'

describe('xiaohongshu resolver helpers', () => {
  it('extracts note ids from supported links', () => {
    expect(extractXiaohongshuNoteId('https://www.xiaohongshu.com/explore/abc123?xsec_token=1')).toBe('abc123')
    expect(extractXiaohongshuNoteId('https://www.xiaohongshu.com/discovery/item/def456')).toBe('def456')
  })

  it('normalizes note state data', () => {
    const result = normalizeXiaohongshuNote('https://www.xiaohongshu.com/explore/abc123', {
      note: {
        title: '笔记标题',
        desc: '笔记正文',
        user: { nickname: '作者' },
        imageList: [{ urlDefault: 'https://img/a.jpg' }],
        video: { media: { stream: { h264: [{ masterUrl: 'https://video/a.mp4' }] } } }
      }
    })

    expect(result).toMatchObject({
      platform: 'xiaohongshu',
      displayName: '小红书',
      title: '笔记标题',
      author: '作者',
      description: '笔记正文',
      images: ['https://img/a.jpg'],
      videos: ['https://video/a.mp4']
    })
    expect('ok' in result).toBe(false)
  })

  it('normalizes note detail maps used by embedded web state', () => {
    const result = normalizeXiaohongshuNote('https://www.xiaohongshu.com/explore/abc123', {
      noteDetailMap: {
        abc123: {
          note: {
            title: '详情标题',
            desc: '详情正文',
            user: { nickname: '作者' },
            imageList: [{ url: 'https://img/b.jpg' }]
          }
        }
      }
    })

    expect(result).toMatchObject({
      platform: 'xiaohongshu',
      title: '详情标题',
      images: ['https://img/b.jpg']
    })
    expect('ok' in result).toBe(false)
  })
})
