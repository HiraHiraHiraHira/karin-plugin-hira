import { describe, expect, it } from 'vitest'

import { buildMusicCookieStatusLines, normalizeQQCookieStatus } from '@/music/cookieStatus'

describe('normalizeQQCookieStatus', () => {
  it('reports logged-in QQ profile without leaking numeric account ids', () => {
    expect(normalizeQQCookieStatus({
      code: 0,
      data: {
        creator: {
          nick: 'Hira',
          encrypt_uin: 'abc123',
          uin: '100001'
        }
      }
    })).toEqual({
      ok: true,
      message: 'Hira'
    })
  })

  it('reports invalid QQ cookies', () => {
    expect(normalizeQQCookieStatus({ code: 1000 })).toEqual({
      ok: false,
      message: 'Cookie 失效或未登录'
    })
  })
})

describe('buildMusicCookieStatusLines', () => {
  it('checks Netease and QQ cookies while showing configured-only state for other sources', async () => {
    const lines = await buildMusicCookieStatusLines({
      cookies: {
        netease: 'MUSIC_U=secret',
        qq: 'uin=10001; qm_keyst=secret',
        kuwo: '',
        kugou: 'kg_mid=secret',
        bilibili: 'SESSDATA=secret'
      },
      checkNetease: async () => ({ ok: true, message: '网易用户' }),
      checkQQ: async () => ({ ok: false, message: 'Cookie 失效或未登录' })
    })

    expect(lines).toEqual([
      '音乐 Cookie 状态',
      '网易云：在线（网易用户）',
      'QQ音乐：失效（Cookie 失效或未登录）',
      '酷我：未配置',
      '酷狗：已配置',
      '哔哩哔哩：已配置'
    ])
  })
})
