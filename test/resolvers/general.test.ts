import { describe, expect, it } from 'vitest'

import { normalizeGeneralApiResponse } from '@/resolvers/general'

describe('normalizeGeneralApiResponse', () => {
  it('normalizes video responses', () => {
    expect(normalizeGeneralApiResponse('皮皮虾', {
      code: 200,
      data: {
        url: 'https://cdn.example.test/a.mp4',
        title: '一个视频'
      }
    })).toEqual({
      platform: 'general',
      displayName: '皮皮虾',
      title: '一个视频',
      videos: ['https://cdn.example.test/a.mp4'],
      images: []
    })
  })

  it('normalizes image responses from common field names', () => {
    expect(normalizeGeneralApiResponse('即刻', {
      data: {
        images: ['https://img.example.test/a.jpg'],
        desc: '一组图片'
      }
    })).toEqual({
      platform: 'general',
      displayName: '即刻',
      title: '一组图片',
      videos: [],
      images: ['https://img.example.test/a.jpg']
    })
  })

  it('does not treat music urls as videos', () => {
    expect(normalizeGeneralApiResponse('抖音', {
      data: {
        title: '图文带 BGM',
        url: 'https://p3.douyinpic.com/obj/ies-music/abc.mp3',
        images: ['https://img.example.test/a.jpg']
      }
    })).toEqual({
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
