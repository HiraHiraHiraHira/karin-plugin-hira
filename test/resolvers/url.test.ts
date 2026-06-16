import { describe, expect, it } from 'vitest'

import { extractFirstUrl, extractShareCardMeta, hostnameOf } from '@/resolvers/url'

describe('resolver url helpers', () => {
  it('extracts the first http url from mixed text', () => {
    expect(extractFirstUrl('看这个 https://weibo.com/123/abc?a=1 真的好笑')).toBe('https://weibo.com/123/abc?a=1')
  })

  it('cleans escaped slashes and trailing punctuation', () => {
    expect(extractFirstUrl('https:\\/\\/youtu.be\\/abc123，')).toBe('https://youtu.be/abc123')
  })

  it('extracts QQ news share metadata from json segments', () => {
    const message = '[json:{"app":"com.tencent.tuwen.lua","meta":{"news":{"desc":"#(呵呵) ","jumpUrl":"https://tieba.baidu.com/p/10781745725?share_from=qq","preview":"http://tiebapic.baidu.com/forum/a.jpg","tag":"百度贴吧","title":"让大学生吃食堂跟害他们一样"}}}]'

    expect(extractShareCardMeta(message)).toEqual({
      desc: '#(呵呵) ',
      jumpUrl: 'https://tieba.baidu.com/p/10781745725?share_from=qq',
      preview: 'http://tiebapic.baidu.com/forum/a.jpg',
      tag: '百度贴吧',
      title: '让大学生吃食堂跟害他们一样'
    })
    expect(extractFirstUrl(message)).toBe('https://tieba.baidu.com/p/10781745725?share_from=qq')
  })

  it('returns hostname safely', () => {
    expect(hostnameOf('https://m.weibo.cn/status/123')).toBe('m.weibo.cn')
    expect(hostnameOf('not-a-url')).toBeUndefined()
  })
})
