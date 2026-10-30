import { describe, expect, it } from 'vitest'

import { parseMusicCommand } from '@/music/commandParser'

describe('parseMusicCommand', () => {
  it('parses default search command', () => {
    expect(parseMusicCommand('#点歌 晴天')).toEqual({
      type: 'search',
      keyword: '晴天',
      source: undefined,
      listMode: false
    })
    expect(parseMusicCommand('#点歌青花')).toEqual({
      type: 'search',
      keyword: '青花',
      source: undefined,
      listMode: false
    })
    expect(parseMusicCommand('来首青花')).toEqual({
      type: 'search',
      keyword: '青花',
      source: undefined,
      listMode: false
    })
    expect(parseMusicCommand('来一首周杰伦的青花瓷')).toEqual({
      type: 'search',
      keyword: '周杰伦的青花瓷',
      source: undefined,
      listMode: false
    })
    expect(parseMusicCommand('放首青花')).toEqual({
      type: 'search',
      keyword: '青花',
      source: undefined,
      listMode: false
    })
  })

  it('parses source-specific search command', () => {
    expect(parseMusicCommand('#QQ点歌 稻香')).toEqual({
      type: 'search',
      keyword: '稻香',
      source: 'qq',
      listMode: false
    })
    expect(parseMusicCommand('#QQ点歌青花')).toEqual({
      type: 'search',
      keyword: '青花',
      source: 'qq',
      listMode: false
    })
    expect(parseMusicCommand('哔哩播放孤勇者')).toEqual({
      type: 'search',
      keyword: '孤勇者',
      source: 'bilibili',
      listMode: false
    })
    expect(parseMusicCommand('B站播放青花')).toEqual({
      type: 'search',
      keyword: '青花',
      source: 'bilibili',
      listMode: false
    })
    expect(parseMusicCommand('网易云来一首青花')).toEqual({
      type: 'search',
      keyword: '青花',
      source: 'netease',
      listMode: false
    })
  })

  it('parses multi-select source commands in either word order', () => {
    expect(parseMusicCommand('#多选网易点歌 夜曲')).toEqual({
      type: 'search',
      keyword: '夜曲',
      source: 'netease',
      listMode: true
    })
    expect(parseMusicCommand('#酷我多选点歌 七里香')).toEqual({
      type: 'search',
      keyword: '七里香',
      source: 'kuwo',
      listMode: true
    })
    expect(parseMusicCommand('多选QQ播放青花')).toEqual({
      type: 'search',
      keyword: '青花',
      source: 'qq',
      listMode: true
    })
    expect(parseMusicCommand('哔哩多选播放孤勇者')).toEqual({
      type: 'search',
      keyword: '孤勇者',
      source: 'bilibili',
      listMode: true
    })
  })

  it('parses session selection only for bare numbers or listen commands', () => {
    expect(parseMusicCommand('2')).toEqual({ type: 'select', index: 2 })
    expect(parseMusicCommand('#听3')).toEqual({ type: 'select', index: 3 })
    expect(parseMusicCommand('#播放4')).toEqual({ type: 'select', index: 4 })
  })

  it('does not parse music cookie commands as compact searches', () => {
    expect(parseMusicCommand('#点歌ck检查')).toEqual({ type: 'none' })
  })

  it('returns an empty-keyword search for bare point-song commands (usage help)', () => {
    expect(parseMusicCommand('#点歌')).toEqual({
      type: 'search',
      keyword: '',
      source: undefined,
      listMode: false
    })
    expect(parseMusicCommand('#QQ点歌')).toEqual({
      type: 'search',
      keyword: '',
      source: 'qq',
      listMode: false
    })
  })

  it('parses QQ personalized commands', () => {
    expect(parseMusicCommand('#每日推荐')).toEqual({ type: 'dailyRecommend' })
    expect(parseMusicCommand('#日推')).toEqual({ type: 'dailyRecommend' })
    expect(parseMusicCommand('每日30首')).toEqual({ type: 'dailyRecommend' })
    expect(parseMusicCommand('#个性电台')).toEqual({ type: 'radio' })
    expect(parseMusicCommand('#我的收藏')).toEqual({ type: 'favorites' })
    expect(parseMusicCommand('#我喜欢的歌 3')).toEqual({ type: 'favorites', page: 3 })
    expect(parseMusicCommand('#QQ我的收藏')).toEqual({ type: 'favorites' })
  })

  it('parses random song requests instead of searching for the keyword 歌', () => {
    expect(parseMusicCommand('#来首歌')).toEqual({ type: 'random' })
    expect(parseMusicCommand('来一首歌')).toEqual({ type: 'random' })
    expect(parseMusicCommand('放首歌')).toEqual({ type: 'random' })
    expect(parseMusicCommand('放一首歌')).toEqual({ type: 'random' })
  })

  it('parses quoted music card download commands', () => {
    expect(parseMusicCommand('#下载音乐')).toEqual({ type: 'download' })
    expect(parseMusicCommand('下载音乐')).toEqual({ type: 'download' })
  })

  it('parses next page, lyrics, and voice commands', () => {
    expect(parseMusicCommand('#下一页')).toEqual({ type: 'nextPage' })
    expect(parseMusicCommand('#歌词')).toEqual({ type: 'lyrics' })
    expect(parseMusicCommand('#歌词 1')).toEqual({ type: 'lyrics', index: 1 })
    expect(parseMusicCommand('#语音')).toEqual({ type: 'voice' })
    expect(parseMusicCommand('#高清语音2')).toEqual({ type: 'voice', index: 2, highQuality: true })
  })

  it('parses Bilibili link-to-music command without matching bare Bilibili links', () => {
    expect(parseMusicCommand('音乐 https://www.bilibili.com/video/BV1xx411c7mD')).toEqual({
      type: 'bilibiliLink',
      url: 'https://www.bilibili.com/video/BV1xx411c7mD'
    })
    expect(parseMusicCommand('https://www.bilibili.com/video/BV1xx411c7mD')).toEqual({ type: 'none' })
  })
})
