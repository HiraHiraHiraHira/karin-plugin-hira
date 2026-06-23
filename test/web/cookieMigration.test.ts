import { describe, expect, it } from 'vitest'

import {
  exportCookieMigrationPayload,
  importCookieMigrationPayload
} from '../../web/src/components/common/config-panel/cookieMigration'
import type { ConfigType } from '../../web/src/types/config'

const baseConfig = (): ConfigType => ({
  app: {
    enabled: true,
    helpCommand: '#Hira帮助',
    replyPrefix: 'Hira',
    statusCommand: '#Hira状态'
  },
  music: {
    enabled: true,
    defaultSource: 'qq',
    listModeDefault: false,
    pageSize: 10,
    sessionTtlSeconds: 180,
    voiceEnabled: true,
    highQuality: false,
    textFallback: true,
    cookies: {
      netease: 'MUSIC_163',
      qq: '',
      kuwo: '  ',
      kugou: '',
      bilibili: 'MUSIC_BILI'
    },
    api: {
      neteaseBaseUrl: 'http://music.163.com/api',
      qqTempApi: 'https://example.test'
    }
  },
  resolver: {
    enabled: true,
    kkkCompat: true,
    commentsEnabled: true,
    priority: 900,
    maxVideoDurationSeconds: 480,
    platforms: {
      bilibili: true,
      douyin: true,
      kuaishou: true,
      weibo: true,
      tieba: true,
      xiaoheihe: true,
      xiaohongshu: true,
      general: true
    },
    sending: {
      contentForwardEnabled: true,
      videoFailureFallbackEnabled: true
    },
    media: {
      dedupeImages: true,
      filterLowQualityImages: true,
      inlinePreviewCover: true
    },
    diagnostics: {
      stageLogsEnabled: true,
      verboseLogsEnabled: true
    },
    bilibili: {
      maxVideoDurationSeconds: 480,
      quality: 64,
      codec: 'auto'
    },
    douyin: {
      maxVideoDurationSeconds: 480,
      quality: '1080p'
    },
    proxy: '',
    cookies: {
      weibo: 'WEIBO',
      xiaoheihe: '',
      douyin: '',
      xiaohongshu: 'XHS',
      bilibili: ''
    },
    generalApis: []
  },
  runtime: {
    tempRoot: '',
    cleanupEnabled: true,
    cleanupMaxAgeMinutes: 120,
    ffmpegPath: 'ffmpeg',
    ffprobePath: 'ffprobe',
    downloadTimeoutSeconds: 60
  },
  light: {
    enabled: true,
    catApis: [],
    buyerShowApis: [],
    tiredApis: [],
    medicineApi: '',
    softwareApi: ''
  },
  translate: {
    enabled: true,
    deeplxApi: '',
    tencentApi: '',
    timeoutSeconds: 15
  },
  ai: {
    summaryEnabled: false,
    apiBaseUrl: 'https://api.openai.com/v1',
    apiKey: '',
    model: 'gpt-4.1-mini',
    maxInputChars: 12000
  }
})

describe('cookie migration helpers', () => {
  it('exports only non-empty music and resolver cookies', () => {
    const raw = exportCookieMigrationPayload(baseConfig(), new Date('2026-06-22T00:00:00.000Z'))
    const payload = JSON.parse(raw)

    expect(payload).toEqual({
      version: 1,
      plugin: 'karin-plugin-hira',
      exportedAt: '2026-06-22T00:00:00.000Z',
      cookies: {
        music: {
          netease: 'MUSIC_163',
          bilibili: 'MUSIC_BILI'
        },
        resolver: {
          weibo: 'WEIBO',
          xiaohongshu: 'XHS'
        }
      }
    })
  })

  it('imports only known non-empty cookies without touching other settings', () => {
    const config = baseConfig()
    const raw = JSON.stringify({
      version: 1,
      plugin: 'karin-plugin-hira',
      cookies: {
        music: {
          qq: ' QQ_COOKIE ',
          unknown: 'ignored'
        },
        resolver: {
          douyin: 'DOUYIN_COOKIE',
          xiaoheihe: ''
        }
      }
    })

    const result = importCookieMigrationPayload(config, raw)

    expect(result).toMatchObject({
      ok: true,
      importedCount: 2,
      labels: ['音乐/QQ音乐', '解析/抖音']
    })
    expect(result.ok && result.config.music.cookies.qq).toBe('QQ_COOKIE')
    expect(result.ok && result.config.resolver.cookies.douyin).toBe('DOUYIN_COOKIE')
    expect(result.ok && result.config.music.cookies.netease).toBe('MUSIC_163')
    expect(config.music.cookies.qq).toBe('')
  })

  it('rejects invalid or empty migration payloads', () => {
    expect(importCookieMigrationPayload(baseConfig(), 'not json')).toEqual({
      ok: false,
      message: '迁移内容不是有效的 Hira Cookie JSON。'
    })
    expect(importCookieMigrationPayload(baseConfig(), JSON.stringify({
      version: 1,
      plugin: 'karin-plugin-hira',
      cookies: {}
    }))).toEqual({
      ok: false,
      message: '迁移内容里没有可导入的 Cookie。'
    })
  })
})
