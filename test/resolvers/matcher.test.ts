import { describe, expect, it } from 'vitest'

import { matchResolver } from '@/resolvers/matcher'

describe('matchResolver', () => {
  it('matches first-class supplemental platforms', () => {
    expect(matchResolver('https://weibo.com/123/abc')?.platform).toBe('weibo')
    expect(matchResolver('https://tieba.baidu.com/p/123')?.platform).toBe('tieba')
    expect(matchResolver('https://www.xiaoheihe.cn/community/123/list/456')?.platform).toBe('xiaoheihe')
    expect(matchResolver('https://www.xiaoheihe.cn/app/bbs/link/abc123')?.platform).toBe('xiaoheihe')
    expect(matchResolver('https://api.xiaoheihe.cn/bbs/app/api/web/share?link_id=abc123')?.platform).toBe('xiaoheihe')
  })

  it('falls back to general resolver for supported smaller platforms', () => {
    expect(matchResolver('https://www.ixigua.com/123')?.platform).toBe('general')
    expect(matchResolver('https://m.okjike.com/originalPosts/abc')?.platform).toBe('general')
  })

  it('matches KKK-owned platforms for Hira full parsing mode', () => {
    expect(matchResolver('https://www.bilibili.com/video/BV14A31eZEH8')?.platform).toBe('bilibili')
    expect(matchResolver('https://b23.tv/abc123')?.platform).toBe('bilibili')
    expect(matchResolver('https://v.douyin.com/abc123')?.platform).toBe('douyin')
    expect(matchResolver('https://www.kuaishou.com/short-video/3xabc')?.platform).toBe('kuaishou')
    expect(matchResolver('https://www.xiaohongshu.com/explore/abc123')?.platform).toBe('xiaohongshu')
    expect(matchResolver('https://xhslink.com/a/abc123')?.platform).toBe('xiaohongshu')
  })

  it('returns undefined for unsupported domains', () => {
    expect(matchResolver('https://youtu.be/abc')).toBeUndefined()
    expect(matchResolver('https://example.com/a')).toBeUndefined()
  })
})
