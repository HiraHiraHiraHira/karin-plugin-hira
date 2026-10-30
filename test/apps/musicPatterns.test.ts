import { describe, expect, it } from 'vitest'

import { musicReg } from '@/apps/music'

describe('music command patterns', () => {
  it('accepts bare voice/lyrics and empty-keyword point-song commands', () => {
    expect(musicReg.test('#语音')).toBe(true)
    expect(musicReg.test('#歌词')).toBe(true)
    expect(musicReg.test('语音')).toBe(true)
    expect(musicReg.test('#高清语音')).toBe(true)
    expect(musicReg.test('#下载音乐')).toBe(true)
    expect(musicReg.test('#点歌')).toBe(true)
    expect(musicReg.test('点歌')).toBe(true)
  })

  it('accepts QQ personalized commands', () => {
    expect(musicReg.test('#每日推荐')).toBe(true)
    expect(musicReg.test('日推')).toBe(true)
    expect(musicReg.test('#每日30首')).toBe(true)
    expect(musicReg.test('#个性电台')).toBe(true)
    expect(musicReg.test('#我的收藏')).toBe(true)
    expect(musicReg.test('我喜欢的歌 2')).toBe(true)
    expect(musicReg.test('#来首歌')).toBe(true)
    expect(musicReg.test('放首歌')).toBe(true)
  })

  it('accepts compact music search commands without catching cookie commands', () => {
    expect(musicReg.test('#点歌青花')).toBe(true)
    expect(musicReg.test('#QQ点歌青花')).toBe(true)
    expect(musicReg.test('来首青花')).toBe(true)
    expect(musicReg.test('来一首周杰伦的青花瓷')).toBe(true)
    expect(musicReg.test('哔哩播放孤勇者')).toBe(true)
    expect(musicReg.test('#点歌ck检查')).toBe(false)
    expect(musicReg.test('#点歌cookie状态')).toBe(false)
    expect(musicReg.test('#提交音乐ckMUSIC_U=abc')).toBe(false)
  })
})
