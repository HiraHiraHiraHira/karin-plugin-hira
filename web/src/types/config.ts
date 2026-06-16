export type MusicSource = 'netease' | 'qq' | 'kuwo' | 'kugou' | 'bilibili'

export type ConfigType = {
  app: {
    enabled: boolean
    helpCommand: string
    replyPrefix: string
    statusCommand: string
  }
  music: {
    enabled: boolean
    defaultSource: MusicSource
    listModeDefault: boolean
    pageSize: number
    sessionTtlSeconds: number
    voiceEnabled: boolean
    highQuality: boolean
    textFallback: boolean
    cookies: {
      netease: string
      qq: string
      kuwo: string
      kugou: string
      bilibili: string
    }
    api: {
      neteaseBaseUrl: string
      qqTempApi: string
    }
  }
  resolver: {
    enabled: boolean
    kkkCompat: boolean
    commentsEnabled: boolean
    priority: number
    maxVideoDurationSeconds: number
    bilibili: {
      maxVideoDurationSeconds: number
      quality: number
      codec: 'auto' | 'av1' | 'hevc' | 'avc'
    }
    douyin: {
      maxVideoDurationSeconds: number
      quality: 'adapt' | '540p' | '720p' | '1080p' | '2k' | '4k'
    }
    proxy: string
    cookies: {
      weibo: string
      xiaoheihe: string
      douyin: string
      xiaohongshu: string
      bilibili: string
    }
    generalApis: string[]
  }
  runtime: {
    tempRoot: string
    cleanupEnabled: boolean
    cleanupMaxAgeMinutes: number
    ffmpegPath: string
    ffprobePath: string
    downloadTimeoutSeconds: number
  }
  light: {
    enabled: boolean
    catApis: string[]
    buyerShowApis: string[]
    tiredApis: string[]
    medicineApi: string
    softwareApi: string
  }
  translate: {
    enabled: boolean
    deeplxApi: string
    tencentApi: string
    timeoutSeconds: number
  }
  ai: {
    summaryEnabled: boolean
    apiBaseUrl: string
    apiKey: string
    model: string
    maxInputChars: number
  }
}
