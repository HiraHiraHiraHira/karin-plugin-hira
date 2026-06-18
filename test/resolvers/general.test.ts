import { describe, expect, it } from 'vitest'

import { normalizeGeneralApiResponse } from '@/resolvers/general'

describe('normalizeGeneralApiResponse', () => {
  it('normalizes video responses', () => {
    expect(normalizeGeneralApiResponse('皮皮虾', {
      code: 200,
      data: {
        url: 'https://cdn.example.test/a.mp4',
        title: '一个视频',
        cover: 'https://img.example.test/cover.jpg'
      }
    })).toMatchObject({
      platform: 'general',
      displayName: '皮皮虾',
      title: '一个视频',
      videos: ['https://cdn.example.test/a.mp4'],
      images: ['https://img.example.test/cover.jpg'],
      extras: {
        coverUrl: 'https://img.example.test/cover.jpg',
        contentBlocks: [
          { type: 'text', text: '一个视频' },
          { type: 'image', url: 'https://img.example.test/cover.jpg' }
        ]
      }
    })
  })

  it('normalizes image responses from common field names', () => {
    expect(normalizeGeneralApiResponse('即刻', {
      data: {
        images: ['https://img.example.test/a.jpg'],
        desc: '一组图片'
      }
    })).toMatchObject({
      platform: 'general',
      displayName: '即刻',
      title: '一组图片',
      videos: [],
      images: ['https://img.example.test/a.jpg'],
      extras: {
        coverUrl: 'https://img.example.test/a.jpg',
        contentBlocks: [
          { type: 'text', text: '一组图片' },
          { type: 'image', url: 'https://img.example.test/a.jpg' }
        ]
      }
    })
  })

  it('can normalize general API responses as a concrete source platform with page url and author metadata', () => {
    expect(normalizeGeneralApiResponse('快手', {
      data: {
        title: '快手标题',
        desc: '快手正文',
        author: '作者',
        avatar: 'https://img.example.test/avatar.jpg',
        coverUrl: 'https://img.example.test/cover.jpg',
        url: 'https://cdn.example.test/video.mp4',
        images: [
          'https://img.example.test/a.jpg?imageView2/2/w/1080',
          'https://img.example.test/a.jpg?imageView2/2/w/240'
        ]
      }
    }, {
      platform: 'kuaishou',
      pageUrl: 'https://www.kuaishou.com/short-video/3xabc'
    })).toMatchObject({
      platform: 'kuaishou',
      displayName: '快手',
      title: '快手标题',
      description: '快手正文',
      author: '作者',
      pageUrl: 'https://www.kuaishou.com/short-video/3xabc',
      videos: ['https://cdn.example.test/video.mp4'],
      images: [
        'https://img.example.test/cover.jpg',
        'https://img.example.test/a.jpg?imageView2/2/w/1080'
      ],
      extras: {
        coverUrl: 'https://img.example.test/cover.jpg',
        authorAvatar: 'https://img.example.test/avatar.jpg',
        contentBlocks: [
          { type: 'text', text: '快手正文' },
          { type: 'image', url: 'https://img.example.test/cover.jpg' },
          { type: 'image', url: 'https://img.example.test/a.jpg?imageView2/2/w/1080' }
        ]
      }
    })
  })

  it('does not treat music urls as videos', () => {
    expect(normalizeGeneralApiResponse('抖音', {
      data: {
        title: '图文带 BGM',
        url: 'https://p3.douyinpic.com/obj/ies-music/abc.mp3',
        images: ['https://img.example.test/a.jpg']
      }
    })).toMatchObject({
      platform: 'general',
      displayName: '抖音',
      title: '图文带 BGM',
      videos: [],
      images: ['https://img.example.test/a.jpg']
    })
  })

  it('returns failure for empty or failed responses', () => {
    expect(normalizeGeneralApiResponse('西瓜', { code: 404, data: null })).toMatchObject({
      platform: 'general',
      ok: false
    })
    expect(normalizeGeneralApiResponse('西瓜', { data: {} })).toMatchObject({
      platform: 'general',
      ok: false
    })
  })
})
