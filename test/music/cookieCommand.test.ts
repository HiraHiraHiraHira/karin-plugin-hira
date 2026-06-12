import { describe, expect, it } from 'vitest'

import { maskCookie, parseMusicCookieCommand } from '@/music/cookieCommand'

describe('parseMusicCookieCommand', () => {
  it('parses submit cookie commands', () => {
    expect(parseMusicCookieCommand('#提交音乐ck 网易云 MUSIC_U=abc; other=1')).toEqual({
      type: 'submit',
      source: 'netease',
      cookie: 'MUSIC_U=abc; other=1'
    })
    expect(parseMusicCookieCommand('#提交音乐ck QQ uin=1; qm_keyst=secret')).toEqual({
      type: 'submit',
      source: 'qq',
      cookie: 'uin=1; qm_keyst=secret'
    })
    expect(parseMusicCookieCommand('#提交点歌ck QQ uin=1; qm_keyst=secret')).toEqual({
      type: 'submit',
      source: 'qq',
      cookie: 'uin=1; qm_keyst=secret'
    })
  })

  it('parses status commands', () => {
    expect(parseMusicCookieCommand('#点歌ck检查')).toEqual({ type: 'status' })
    expect(parseMusicCookieCommand('#音乐cookie状态')).toEqual({ type: 'status' })
    expect(parseMusicCookieCommand('#音乐ck检查')).toEqual({ type: 'status' })
    expect(parseMusicCookieCommand('#点歌cookie状态')).toEqual({ type: 'status' })
  })

  it('ignores invalid commands and unsupported sources', () => {
    expect(parseMusicCookieCommand('#提交音乐ck 米哈游 abc')).toEqual({ type: 'none' })
    expect(parseMusicCookieCommand('#点歌 周杰伦')).toEqual({ type: 'none' })
  })
})

describe('maskCookie', () => {
  it('masks sensitive cookie values without exposing secrets', () => {
    expect(maskCookie('MUSIC_U=abcdef123456; uin=10001; qm_keyst=secret')).toBe('MUSIC_U=abc...456; uin=*****; qm_keyst=******')
  })

  it('handles empty cookies', () => {
    expect(maskCookie('')).toBe('未配置')
  })
})
