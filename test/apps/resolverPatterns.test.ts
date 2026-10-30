import { describe, expect, it } from 'vitest'

import { resolverReg } from '@/apps/resolvers'

describe('resolver command patterns', () => {
  it('ignores JSON card payloads for supplemental resolver commands', () => {
    const qqMusicCard = '{"app":"com.tencent.music.lua","meta":{"music":{"jumpUrl":"https://y.qq.com/n/yqq/song/abc.html"}}}'
    const jsonArrayCard = '[{"type":"text","text":"https://example.test/card"}]'
    const qqMusicJsonSegment = '[json:{"app":"com.tencent.music.lua","meta":{"music":{"jumpUrl":"https://y.qq.com/n/yqq/song/abc.html"}}}]'

    expect(resolverReg.test(qqMusicCard)).toBe(false)
    expect(resolverReg.test(jsonArrayCard)).toBe(false)
    expect(resolverReg.test(qqMusicJsonSegment)).toBe(false)
    expect(resolverReg.test('看看这个 https://weibo.com/123/abc')).toBe(true)
  })

  it('accepts bracket-prefixed text shares such as Xiaoheihe messages', () => {
    expect(resolverReg.test('[小黑盒] 看这个帖子 https://www.xiaoheihe.cn/app/bbs/link/abc123')).toBe(true)
  })

  it('prescreens bare share ids and edge domains while ignoring plain chatter', () => {
    expect(resolverReg.test('分享一个 BV14A31eZEH8 好看')).toBe(true)
    expect(resolverReg.test('看看这个 https://xhslink.cn/abc123')).toBe(true)
    expect(resolverReg.test('今天天气真好')).toBe(false)
    // 文件名、编号类同形文本不该被预筛放行
    expect(resolverReg.test('附件BV1xx411c7mD.zip')).toBe(false)
    expect(resolverReg.test('这是AC4567号文件')).toBe(false)
  })

  it('accepts live room and bangumi links for the resolver pipeline', () => {
    expect(resolverReg.test('https://live.bilibili.com/12345')).toBe(true)
    expect(resolverReg.test('https://www.bilibili.com/bangumi/play/ep123')).toBe(true)
    expect(resolverReg.test('https://live.douyin.com/123456')).toBe(true)
    expect(resolverReg.test('https://webcast.amemv.com/douyin/webcast/reflow/7654321 直播间')).toBe(true)
  })

  it('accepts Xiaoheihe QQ json share cards because the jumpUrl is parseable', () => {
    const xiaoheiheCard = '[json:{"app":"com.tencent.tuwen.lua","meta":{"news":{"desc":"下载小黑盒查看更多精彩内容","jumpUrl":"https://api.xiaoheihe.cn/v3/bbs/app/api/web/share?h_camp=link&link_id=4cef71f914bb","tag":"小黑盒","title":"玩了五小时，说一下这个游戏"}}}][分享]玩了五小时，说一下这个游戏'

    expect(resolverReg.test(xiaoheiheCard)).toBe(true)
  })
})
