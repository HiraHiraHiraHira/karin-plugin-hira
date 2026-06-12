import type { MusicSource } from '@/music/types'

export type AppConfig = {
  enabled: boolean
  helpCommand: string
  replyPrefix: string
  statusCommand: string
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

export type ResolverConfig = {
  enabled: boolean
  kkkCompat: boolean
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

export type RuntimeConfig = {
  tempRoot: string
  cleanupEnabled: boolean
  cleanupMaxAgeMinutes: number
  ffmpegPath: string
  ffprobePath: string
  downloadTimeoutSeconds: number
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
