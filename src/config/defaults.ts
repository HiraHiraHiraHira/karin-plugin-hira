import type { HiraConfig } from '@/types/config'
import { defaultBilibiliAppKey, defaultBilibiliAppSecret } from '@/music/providers/bilibili'

export const defaultConfig: HiraConfig = {
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
    card: {
      channels: ['platform', 'ark', 'music'],
      textFallback: true,
      platform: {
        enabled: true,
        types: {
          qq: '',
          netease: '163',
          kuwo: '',
          kugou: '',
          bilibili: ''
        }
      },
      ark: {
        apiUrl: 'https://apii.xianyuw.cn/api/v1/qq-musicArk',
        key: '',
        timeoutMs: 5000,
        retries: 1,
        attachCover: false,
        formats: {
          qq: 'qq',
          netease: 'netease',
          kuwo: '',
          kugou: 'kugou',
          bilibili: 'bilibili'
        }
      },
      music: {
        enabled: true
      },
      breaker: {
        failThreshold: 3,
        cooldownSeconds: 600
      }
    },
    bilibili: {
      // B站 Android 客户端公开凭据，内置为默认值（装上就能用），可覆盖
      appKey: defaultBilibiliAppKey,
      appSecret: defaultBilibiliAppSecret
    },
    cookies: {
      netease: '',
      qq: '',
      kuwo: '',
      kugou: '',
      bilibili: ''
    },
    api: {
      neteaseBaseUrl: 'https://music.163.com/api',
      qqTempApi: 'https://www.hhlqilongzhu.cn/api/dg_QQmusicflac.php?msg={keyword}&n={index}&type=json',
      aggregatorUrl: 'https://music.txqq.pro/',
      aggregatorEnabled: true
    }
  },
  resolver: {
    enabled: true,
    kkkCompat: true,
    commentsEnabled: true,
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
      weibo: '',
      xiaoheihe: '',
      douyin: '',
      xiaohongshu: '',
      bilibili: ''
    },
    generalApis: [
      'http://47.99.158.118/video-crack/v2/parse?content={url}',
      'https://api.jkyai.top/API/jhspjx.php?url={url}',
      'https://api.yujn.cn/api/pipixia.php?url={url}',
      'https://api.bugpk.com/api/pipixia?url={url}'
    ]
  },
  runtime: {
    tempRoot: '',
    cleanupEnabled: true,
    cleanupMaxAgeMinutes: 120,
    ffmpegPath: 'ffmpeg',
    ffprobePath: 'ffprobe',
    downloadTimeoutSeconds: 60,
    maxVideoFileSizeBytes: 200 * 1024 * 1024,
    maxAudioFileSizeBytes: 100 * 1024 * 1024,
    maxPreviewCoverBytes: 10 * 1024 * 1024,
    maxTempBytes: 2 * 1024 * 1024 * 1024
  },
  light: {
    enabled: true,
    catApis: [
      'https://shibe.online/api/cats?count=1',
      'https://api.thecatapi.com/v1/images/search?limit=1'
    ],
    buyerShowApis: [
      'https://api.vvhan.com/api/tao'
    ],
    tiredApis: [
      'https://api.vvhan.com/api/wallpaper/views'
    ],
    medicineApi: 'https://api.oioweb.cn/api/common/DrugSearch?keyword={keyword}',
    softwareApi: 'https://api.oioweb.cn/api/common/SoftwareSearch?keyword={keyword}'
  },
  translate: {
    enabled: true,
    deeplxApi: '',
    tencentApi: 'https://api.interpreter.caiyunai.com/v1/translator',
    timeoutSeconds: 15
  },
  ai: {
    summaryEnabled: false,
    apiBaseUrl: 'https://api.openai.com/v1',
    apiKey: '',
    model: 'gpt-4.1-mini',
    maxInputChars: 12000
  }
}
