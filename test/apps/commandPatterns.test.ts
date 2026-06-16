import { describe, expect, it } from 'vitest'

import { helpReg } from '@/apps/help'
import { musicReg } from '@/apps/music'
import { resolverReg } from '@/apps/resolvers'
import { cleanupReg, statusReg } from '@/apps/status'

describe('app command patterns', () => {
  it('accepts compact music search commands without catching cookie commands', () => {
    expect(musicReg.test('#点歌青花')).toBe(true)
    expect(musicReg.test('#QQ点歌青花')).toBe(true)
    expect(musicReg.test('来首青花')).toBe(true)
    expect(musicReg.test('来一首周杰伦的青花瓷')).toBe(true)
    expect(musicReg.test('哔哩播放孤勇者')).toBe(true)
    expect(musicReg.test('#点歌ck检查')).toBe(false)
    expect(musicReg.test('#点歌cookie状态')).toBe(false)
  })

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

  it('accepts Xiaoheihe QQ json share cards because the jumpUrl is parseable', () => {
    const xiaoheiheCard = '[json:{"app":"com.tencent.tuwen.lua","meta":{"news":{"desc":"下载小黑盒查看更多精彩内容","jumpUrl":"https://api.xiaoheihe.cn/v3/bbs/app/api/web/share?h_camp=link&link_id=4cef71f914bb","tag":"小黑盒","title":"玩了五小时，说一下这个游戏"}}}][分享]玩了五小时，说一下这个游戏'

    expect(resolverReg.test(xiaoheiheCard)).toBe(true)
  })

  it('accepts Hira command aliases with hira and hi prefixes', () => {
    expect(helpReg.test('#Hira帮助')).toBe(true)
    expect(helpReg.test('hira帮助')).toBe(true)
    expect(helpReg.test('#hi帮助')).toBe(true)

    expect(statusReg.test('#Hira状态')).toBe(true)
    expect(statusReg.test('hira状态')).toBe(true)
    expect(statusReg.test('#hi状态')).toBe(true)

    expect(cleanupReg.test('#Hira清理垃圾')).toBe(true)
    expect(cleanupReg.test('hira清理垃圾')).toBe(true)
    expect(cleanupReg.test('#hi清理垃圾')).toBe(true)
    expect(cleanupReg.test('#清理垃圾')).toBe(true)
  })
})
