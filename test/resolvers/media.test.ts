import { describe, expect, it } from 'vitest'

import {
  dedupeRichContentBlocks,
  isUsableImageUrl,
  normalizeMediaKey,
  selectBestImageUrl
} from '@/resolvers/media'

describe('resolver media helpers', () => {
  it('deduplicates image variants by stable media identity', () => {
    expect(normalizeMediaKey('https://img.example.test/a.jpg?imageView2/2/w/540/format/webp')).toBe('https://img.example.test/a.jpg')
    expect(normalizeMediaKey('https://img.example.test/a.jpg?x-oss-process=image/resize,w_120')).toBe('https://img.example.test/a.jpg')
    expect(normalizeMediaKey('https://img.example.test/a.jpg\\')).toBe('https://img.example.test/a.jpg')
  })

  it('rejects obvious blurred, mosaic, thumbnail, and placeholder images', () => {
    expect(isUsableImageUrl('https://sns-img-qc.xhscdn.com/a.jpg?imageMogr2/blur/50x50')).toBe(false)
    expect(isUsableImageUrl('https://sns-img-qc.xhscdn.com/a-mosaic.jpg')).toBe(false)
    expect(isUsableImageUrl('https://img.example.test/thumb/a.jpg')).toBe(false)
    expect(isUsableImageUrl('https://img.example.test/original/a.jpg')).toBe(true)
  })

  it('selects the best non-mosaic image candidate and keeps a fallback when every candidate is imperfect', () => {
    expect(selectBestImageUrl([
      'https://sns-img-qc.xhscdn.com/a.jpg?imageMogr2/blur/50x50',
      'https://sns-img-qc.xhscdn.com/a.jpg?imageView2/2/w/1080/format/webp',
      'https://sns-img-qc.xhscdn.com/a.jpg?imageView2/2/w/240/format/webp'
    ])).toBe('https://sns-img-qc.xhscdn.com/a.jpg?imageView2/2/w/1080/format/webp')

    expect(selectBestImageUrl([
      'https://sns-img-qc.xhscdn.com/fallback.jpg?imageView2/2/w/180/format/webp'
    ])).toBe('https://sns-img-qc.xhscdn.com/fallback.jpg?imageView2/2/w/180/format/webp')
  })

  it('deduplicates image blocks while preserving text and first image order', () => {
    expect(dedupeRichContentBlocks([
      { type: 'text', text: '正文' },
      { type: 'image', url: 'https://img.example.test/a.jpg?imageView2/2/w/1080' },
      { type: 'image', url: 'https://img.example.test/a.jpg?imageView2/2/w/240' },
      { type: 'image', url: 'https://img.example.test/b.jpg' }
    ])).toEqual([
      { type: 'text', text: '正文' },
      { type: 'image', url: 'https://img.example.test/a.jpg?imageView2/2/w/1080' },
      { type: 'image', url: 'https://img.example.test/b.jpg' }
    ])
  })
})
