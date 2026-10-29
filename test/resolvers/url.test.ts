import { describe, expect, it } from 'vitest'

import { extractFirstUrl, extractShareCardMeta, hostnameOf } from '@/resolvers/url'

describe('resolver url helpers', () => {
  it('extracts the first http url from mixed text', () => {
    expect(extractFirstUrl('看这个 https://weibo.com/123/abc?a=1 真的好笑')).toBe('https://weibo.com/123/abc?a=1')
  })

  it('cleans escaped slashes and trailing punctuation', () => {
    expect(extractFirstUrl('https:\\/\\/youtu.be\\/abc123，')).toBe('https://youtu.be/abc123')
  })

  it('drops trailing Chinese prose glued to the link', () => {
    expect(extractFirstUrl('看这个 https://b23.tv/abc，好看')).toBe('https://b23.tv/abc')
    // 无标点直接粘汉字时也要截断，否则分享码会吃到后续正文。
    expect(extractFirstUrl('https://b23.tv/abc看看这个')).toBe('https://b23.tv/abc')
    expect(extractFirstUrl('【分享】https://www.xiaohongshu.com/explore/64f0abc？')).toBe('https://www.xiaohongshu.com/explore/64f0abc')
    expect(extractFirstUrl('https://tieba.baidu.com/p/10781745725?share_from=qq')).toBe('https://tieba.baidu.com/p/10781745725?share_from=qq')
  })

  it('strips credential params from share card jumpUrl but keeps functional ones', () => {
    const shareCard = (jumpUrl: string) =>
      `[json:{"meta":{"news":{"title":"分享","jumpUrl":"${jumpUrl}"}}}]`

    // 裸 key 是站点功能参数，删掉会改坏链接，只删明确的登录凭据。
    expect(extractShareCardMeta(shareCard('https://example.com/a?access_token=secret&key=xx'))?.jumpUrl)
      .toBe('https://example.com/a?key=xx')
    expect(extractShareCardMeta(shareCard('https://example.com/a?p_skey=1&skey=2&ticket=3&wxuin=4'))?.jumpUrl)
      .toBe('https://example.com/a')
  })

  it('expands bare BV and AcFun ids shared as plain text', () => {
    expect(extractFirstUrl('分享一个 BV14A31eZEH8 好看')).toBe('https://www.bilibili.com/video/BV14A31eZEH8')
    expect(extractFirstUrl('ac123456')).toBe('https://www.acfun.cn/v/ac123456')
    expect(extractFirstUrl('今天天气真好')).toBeUndefined()
  })

  it('ignores look-alike text that is not a bare share id', () => {
    // 文件名/编号类文本不是分享意图，补全不出可解析 id 时不该触发解析失败回复。
    expect(extractFirstUrl('附件BV1xx411c7mD.zip')).toBeUndefined()
    expect(extractFirstUrl('这是AC4567号文件')).toBeUndefined()
    expect(extractFirstUrl('ac12345')).toBeUndefined()
    // 0OIl 不在 B站 base58 字符集里，这种 BV 是抄错的。
    expect(extractFirstUrl('BV0OIl12345')).toBeUndefined()
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
