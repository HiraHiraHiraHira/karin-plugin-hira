import type { MusicSource } from '@/music/types'

export type AppConfig = {
  enabled: boolean
  helpCommand: string
  replyPrefix: string
  statusCommand: string
}

export type MusicCardChannel = 'platform' | 'ark' | 'music'

export type MusicCardConfig = {
  /** 发送通道优先级，前面的失败自动降级到后面 */
  channels: MusicCardChannel[]
  /** 卡片之外是否附带「标题 - 歌手 + 链接」文字行 */
  textFallback: boolean
  platform: {
    enabled: boolean
    /** 平台 -> OneBot 音乐卡片类型；留空表示该平台跳过（搜索拿不到标准卡要的数字 ID） */
    types: {
      qq: string
      netease: string
      kuwo: string
      kugou: string
      bilibili: string
    }
  }
  ark: {
    apiUrl: string
    /** 空 = 不启用 ark 通道 */
    key: string
    timeoutMs: number
    retries: number
    /** ark 卡片自带封面，默认不再单独发一张图 */
    attachCover: boolean
    /** 平台 -> 签名服务 format 参数，空字符串表示该平台跳过 ark */
    formats: {
      qq: string
      netease: string
      kuwo: string
      kugou: string
      bilibili: string
    }
  }
  music: {
    enabled: boolean
  }
  breaker: {
    failThreshold: number
    cooldownSeconds: number
  }
}

export type MusicConfig = {
  enabled: boolean
  defaultSource: MusicSource
  listModeDefault: boolean
  pageSize: number
  sessionTtlSeconds: number
  voiceEnabled: boolean
  highQuality: boolean
  textFallback: boolean
  card: MusicCardConfig
  bilibili: {
    appKey: string
    appSecret: string
  }
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
    /** txqq.pro 聚合音源，作为各平台原生接口的兜底 */
    aggregatorUrl: string
    aggregatorEnabled: boolean
  }
}

export type ResolverConfig = {
  enabled: boolean
  kkkCompat: boolean
  commentsEnabled: boolean
  priority: number
  maxVideoDurationSeconds: number
  platforms: {
    bilibili: boolean
    douyin: boolean
    kuaishou: boolean
    weibo: boolean
    tieba: boolean
    xiaoheihe: boolean
    xiaohongshu: boolean
    general: boolean
  }
  sending: {
    contentForwardEnabled: boolean
    videoFailureFallbackEnabled: boolean
  }
  media: {
    dedupeImages: boolean
    filterLowQualityImages: boolean
    inlinePreviewCover: boolean
  }
  diagnostics: {
    stageLogsEnabled: boolean
    verboseLogsEnabled: boolean
  }
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

export type RuntimeConfig = {
  tempRoot: string
  cleanupEnabled: boolean
  cleanupMaxAgeMinutes: number
  ffmpegPath: string
  ffprobePath: string
  downloadTimeoutSeconds: number
  maxVideoFileSizeBytes: number
  maxPreviewCoverBytes: number
  maxTempBytes: number
}

export type LightConfig = {
  enabled: boolean
  catApis: string[]
  buyerShowApis: string[]
  tiredApis: string[]
  medicineApi: string
  softwareApi: string
}

export type TranslateConfig = {
  enabled: boolean
  deeplxApi: string
  tencentApi: string
  timeoutSeconds: number
}

export type AiConfig = {
  summaryEnabled: boolean
  apiBaseUrl: string
  apiKey: string
  model: string
  maxInputChars: number
}

export type HiraConfig = {
  app: AppConfig
  music: MusicConfig
  resolver: ResolverConfig
  runtime: RuntimeConfig
  light: LightConfig
  translate: TranslateConfig
  ai: AiConfig
}
