import { describe, expect, it } from 'vitest'

import { defaultConfig } from '@/config/defaults'
import { flattenConfig, mergeConfigPatch, unflattenConfig } from '@/web/configAdapter'

describe('web config adapter', () => {
  it('flattens and unflattens nested config with dot keys', () => {
    const flat = flattenConfig(defaultConfig)

    expect(flat['app.enabled']).toBe(true)
    expect(flat['music.defaultSource']).toBe('qq')
    expect(flat['music.api.neteaseBaseUrl']).toBe('http://music.163.com/api')
    expect(flat['music.cookies.netease']).toBe('')

    expect(unflattenConfig({ 'app.enabled': false, 'music.pageSize': 5 })).toEqual({
      app: { enabled: false },
      music: { pageSize: 5 }
    })
  })

  it('merges flat WebUI patches into existing config', () => {
    expect(mergeConfigPatch(defaultConfig, {
      'app.replyPrefix': 'Hira',
      'music.pageSize': 8,
      'resolver.kkkCompat': false
    })).toMatchObject({
      app: { replyPrefix: 'Hira' },
      music: { pageSize: 8 },
      resolver: { kkkCompat: false }
    })
  })

  it('merges Karin accordion form results back into nested config', () => {
    expect(mergeConfigPatch(defaultConfig, {
      hiraConfig: [
        {
          appEnabled: false,
          appReplyPrefix: 'Hira',
          appHelpCommand: '#Hira帮助',
          appStatusCommand: '#Hira状态'
        },
        {
          musicEnabled: true,
          musicDefaultSource: 'qq',
          musicPageSize: '6'
        },
        {
          resolverPriority: '950',
          resolverKkkCompat: false,
          resolverBilibiliMaxVideoDurationMinutes: '20',
          resolverBilibiliQuality: '80',
          resolverBilibiliCodec: 'avc',
          resolverDouyinMaxVideoDurationMinutes: '15',
          resolverDouyinQuality: '720p',
          resolverCookiesDouyin: 'douyin-cookie',
          resolverCookiesXiaohongshu: 'xhs-cookie',
          resolverCookiesBilibili: 'bili-cookie'
        }
      ]
    })).toMatchObject({
      app: { enabled: false, replyPrefix: 'Hira' },
      music: { defaultSource: 'qq', pageSize: '6' },
      resolver: {
        priority: '950',
        kkkCompat: false,
        bilibili: {
          maxVideoDurationSeconds: 1200,
          quality: '80',
          codec: 'avc'
        },
        douyin: {
          maxVideoDurationSeconds: 900,
          quality: '720p'
        },
        cookies: {
          douyin: 'douyin-cookie',
          xiaohongshu: 'xhs-cookie',
          bilibili: 'bili-cookie'
        }
      }
    })
  })
})
