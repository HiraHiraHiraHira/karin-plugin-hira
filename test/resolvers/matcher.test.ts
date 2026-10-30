import { describe, expect, it } from 'vitest'

import {
  matchResolver,
  PLATFORM_DOMAINS,
  RESOLVER_DOMAIN_PATTERN,
  RESOLVER_DOMAINS
} from '@/resolvers/matcher'

describe('matchResolver', () => {
  it('keeps the domain table and the command-layer pattern in sync', () => {
    // 新增平台只改 PLATFORM_DOMAINS 一处：命令层正则与匹配规则都必须自动跟上。
    expect(RESOLVER_DOMAINS).toEqual(Object.values(PLATFORM_DOMAINS).flat())
    const patternEntries = RESOLVER_DOMAIN_PATTERN.split('|')
    for (const [platform, domains] of Object.entries(PLATFORM_DOMAINS)) {
      for (const domain of domains) {
        expect(patternEntries).toContain(domain.replace(/\./g, '\\.'))
        expect(matchResolver(`https://${domain}/p/1`)?.platform).toBe(platform)
      }
    }
  })

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

  it('matches edge domains for plain-text shares', () => {
    expect(matchResolver('https://xhslink.cn/abc123')?.platform).toBe('xiaohongshu')
    expect(matchResolver('https://m.weibo.cn/detail/1')?.platform).toBe('weibo')
    expect(matchResolver('https://m.weibo.cn/detail/501234567890')?.platform).toBe('weibo')
    expect(matchResolver('https://www.acfun.cn/v/ac123')?.platform).toBe('general')
    expect(matchResolver('https://www.acfun.cn/v/ac123456')?.platform).toBe('general')
  })

  it('matches subdomains without matching look-alike hosts', () => {
    expect(matchResolver('https://live.bilibili.com/123')?.platform).toBe('bilibili')
    expect(matchResolver('https://live.douyin.com/123456')?.platform).toBe('douyin')
    expect(matchResolver('https://webcast.amemv.com/douyin/webcast/reflow/7654321')?.platform).toBe('douyin')
    expect(matchResolver('https://api.xiaoheihe.cn/bbs/app/api/web/share?link_id=1')?.platform).toBe('xiaoheihe')
    // 后缀判定必须带点，否则 evilbilibili.com 会被误当成哔哩哔哩。
    expect(matchResolver('https://evilbilibili.com/video/BV14A31eZEH8')).toBeUndefined()
    expect(matchResolver('https://b23.tv.evil.com/abc')).toBeUndefined()
  })

  it('routes non-video Bilibili links to the bilibili resolver', () => {
    expect(matchResolver('https://www.bilibili.com/bangumi/play/ep123')?.platform).toBe('bilibili')
    expect(matchResolver('https://www.bilibili.com/bangumi/play/ss456')?.platform).toBe('bilibili')
    expect(matchResolver('https://www.bilibili.com/read/cv789')?.platform).toBe('bilibili')
    expect(matchResolver('https://t.bilibili.com/998877')?.platform).toBe('bilibili')
    expect(matchResolver('https://www.bilibili.com/opus/998877')?.platform).toBe('bilibili')
    expect(matchResolver('https://www.bilibili.com/video/av170001')?.platform).toBe('bilibili')
  })

  it('requires a /p/<id> path before treating tieba as a post', () => {
    expect(matchResolver('https://tieba.baidu.com/f?kw=hira')).toBeUndefined()
    expect(matchResolver('https://tieba.baidu.com/p/10781745725?share_from=qq')?.platform).toBe('tieba')
  })

  it('returns undefined for unsupported domains', () => {
    expect(matchResolver('https://youtu.be/abc')).toBeUndefined()
    expect(matchResolver('https://example.com/a')).toBeUndefined()
  })
})
