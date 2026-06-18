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
      displayName: '小红书笔记',
      title: '笔记标题',
      author: '作者',
      description: '笔记正文',
      images: ['https://img/a.jpg'],
      videos: ['https://video/a.mp4'],
      extras: {
        coverUrl: 'https://img/a.jpg',
        contentBlocks: [
          { type: 'text', text: '笔记正文' },
          { type: 'image', url: 'https://img/a.jpg' }
        ]
      }
    })
    expect('ok' in result).toBe(false)
  })

  it('keeps one best image url per Xiaohongshu image item to avoid duplicate mosaic variants', () => {
    const result = normalizeXiaohongshuNote('https://www.xiaohongshu.com/explore/abc123', {
      note: {
        title: '单图笔记',
        desc: '正文',
        imageList: [{
          urlDefault: 'https://img/full.jpg',
          url: 'https://img/mosaic.jpg',
          urlPre: 'https://img/preview.jpg'
        }]
      }
    })

    expect(result).toMatchObject({
      platform: 'xiaohongshu',
      images: ['https://img/full.jpg'],
      extras: {
        coverUrl: 'https://img/full.jpg',
        contentBlocks: [
          { type: 'text', text: '正文' },
          { type: 'image', url: 'https://img/full.jpg' }
        ]
      }
    })
    expect('ok' in result).toBe(false)
  })

  it('filters obvious Xiaohongshu mosaic image candidates before building images and content blocks', () => {
    const result = normalizeXiaohongshuNote('https://www.xiaohongshu.com/explore/abc123', {
      note: {
        title: '单图笔记',
        desc: '正文',
        imageList: [
          {
            urlDefault: 'https://sns-img-qc.xhscdn.com/a.jpg?imageMogr2/blur/50x50',
            url: 'https://sns-img-qc.xhscdn.com/a.jpg?imageView2/2/w/1080/format/webp',
            urlPre: 'https://sns-img-qc.xhscdn.com/a.jpg?imageView2/2/w/240/format/webp'
          },
          {
            urlDefault: 'https://sns-img-qc.xhscdn.com/a.jpg?imageView2/2/w/240/format/webp',
            url: 'https://sns-img-qc.xhscdn.com/a.jpg?imageView2/2/w/1080/format/webp'
          }
        ]
      }
    })

    expect(result).toMatchObject({
      platform: 'xiaohongshu',
      images: ['https://sns-img-qc.xhscdn.com/a.jpg?imageView2/2/w/1080/format/webp'],
      extras: {
        coverUrl: 'https://sns-img-qc.xhscdn.com/a.jpg?imageView2/2/w/1080/format/webp',
        contentBlocks: [
          { type: 'text', text: '正文' },
          { type: 'image', url: 'https://sns-img-qc.xhscdn.com/a.jpg?imageView2/2/w/1080/format/webp' }
        ]
      }
    })
    expect('ok' in result).toBe(false)
  })

  it('keeps Xiaohongshu video notes usable when video URLs are unavailable by falling back to cover and link', () => {
    const result = normalizeXiaohongshuNote('https://www.xiaohongshu.com/explore/abc123', {
      note: {
        title: '视频笔记',
        desc: '视频正文',
        type: 'video',
        user: { nickname: '作者' },
        imageList: [{ urlDefault: 'https://sns-img-qc.xhscdn.com/cover.jpg' }],
        video: { media: { stream: {} } }
      }
    })

    expect(result).toMatchObject({
      platform: 'xiaohongshu',
      title: '视频笔记',
      images: ['https://sns-img-qc.xhscdn.com/cover.jpg'],
      videos: [],
      description: expect.stringContaining('视频资源暂不可用'),
      pageUrl: 'https://www.xiaohongshu.com/explore/abc123'
    })
    expect('ok' in result).toBe(false)
  })

  it('prefers stable Xiaohongshu video backup urls before signed master urls', () => {
    const result = normalizeXiaohongshuNote('https://www.xiaohongshu.com/explore/abc123', {
      note: {
        title: '视频标题',
        type: 'video',
        imageList: [{ urlDefault: 'https://img/cover.jpg' }],
        video: {
          media: {
            stream: {
              h264: [{
                masterUrl: 'https://sns-video-v3.xhscdn.com/video.mp4?sign=abc&t=123',
                backupUrls: [
                  'https://sns-bak-v1.xhscdn.com/video.mp4',
                  'https://sns-bak-v6.xhscdn.com/video.mp4'
                ]
              }]
            }
          }
        }
      }
    })

    expect(result).toMatchObject({
      platform: 'xiaohongshu',
      videos: [
        'https://sns-bak-v1.xhscdn.com/video.mp4',
        'https://sns-bak-v6.xhscdn.com/video.mp4',
        'https://sns-video-v3.xhscdn.com/video.mp4?sign=abc&t=123'
      ]
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

  it('normalizes real embedded state where note is a container', () => {
    const result = normalizeXiaohongshuNote('https://www.xiaohongshu.com/explore/abc123', {
      note: {
        currentNoteId: 'abc123',
        noteDetailMap: {
          abc123: {
            note: {
              title: '真实页面标题',
              desc: '真实页面正文',
              type: 'normal',
              user: { nickname: '作者' },
              imageList: [{ urlDefault: 'https://img/real.jpg' }]
            }
          }
        }
      }
    })

    expect(result).toMatchObject({
      platform: 'xiaohongshu',
      title: '真实页面标题',
      images: ['https://img/real.jpg']
    })
    expect('ok' in result).toBe(false)
  })
})
