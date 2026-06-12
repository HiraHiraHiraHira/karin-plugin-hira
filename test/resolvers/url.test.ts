import { describe, expect, it } from 'vitest'

import { extractFirstUrl, hostnameOf } from '@/resolvers/url'

describe('resolver url helpers', () => {
  it('extracts the first http url from mixed text', () => {
    expect(extractFirstUrl('看这个 https://weibo.com/123/abc?a=1 真的好笑')).toBe('https://weibo.com/123/abc?a=1')
  })

  it('cleans escaped slashes and trailing punctuation', () => {
    expect(extractFirstUrl('https:\\/\\/youtu.be\\/abc123，')).toBe('https://youtu.be/abc123')
  })

  it('returns hostname safely', () => {
    expect(hostnameOf('https://m.weibo.cn/status/123')).toBe('m.weibo.cn')
    expect(hostnameOf('not-a-url')).toBeUndefined()
  })
})
