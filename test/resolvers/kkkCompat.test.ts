import { describe, expect, it } from 'vitest'

import { shouldSkipForKkkCompat } from '@/resolvers/kkkCompat'

describe('shouldSkipForKkkCompat', () => {
  it('skips domains already handled by KKK', () => {
    expect(shouldSkipForKkkCompat('https://www.bilibili.com/video/BV1xx411c7mD', true)).toBe(true)
    expect(shouldSkipForKkkCompat('https://v.douyin.com/abc', true)).toBe(true)
    expect(shouldSkipForKkkCompat('https://www.kuaishou.com/short-video/abc', true)).toBe(true)
    expect(shouldSkipForKkkCompat('https://www.xiaohongshu.com/explore/abc', true)).toBe(true)
  })

  it('does not skip supplemental domains or disabled compat mode', () => {
    expect(shouldSkipForKkkCompat('https://weibo.com/123/abc', true)).toBe(false)
    expect(shouldSkipForKkkCompat('https://www.bilibili.com/video/BV1xx411c7mD', false)).toBe(false)
  })
})
