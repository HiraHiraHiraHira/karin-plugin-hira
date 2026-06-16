import type { HiraConfig } from '@/types/config'

type ValidationRule = {
  path: string
  label: string
  min?: number
  max?: number
}

const numberRules: ValidationRule[] = [
  { path: 'music.pageSize', label: 'music.pageSize', min: 1, max: 20 },
  { path: 'music.sessionTtlSeconds', label: 'music.sessionTtlSeconds', min: 30, max: 3600 },
  { path: 'resolver.priority', label: 'resolver.priority', min: 0, max: 9999 },
  { path: 'resolver.maxVideoDurationSeconds', label: 'resolver.maxVideoDurationSeconds', min: 0, max: 21600 },
  { path: 'resolver.bilibili.maxVideoDurationSeconds', label: 'resolver.bilibili.maxVideoDurationSeconds', min: 0, max: 21600 },
  { path: 'resolver.douyin.maxVideoDurationSeconds', label: 'resolver.douyin.maxVideoDurationSeconds', min: 0, max: 21600 },
  { path: 'runtime.cleanupMaxAgeMinutes', label: 'runtime.cleanupMaxAgeMinutes', min: 1, max: 10080 },
  { path: 'runtime.downloadTimeoutSeconds', label: 'runtime.downloadTimeoutSeconds', min: 5, max: 600 },
  { path: 'translate.timeoutSeconds', label: 'translate.timeoutSeconds', min: 1, max: 120 },
  { path: 'ai.maxInputChars', label: 'ai.maxInputChars', min: 1000, max: 200000 }
]

const bilibiliCodecs = ['auto', 'av1', 'hevc', 'avc']
const douyinQualities = ['adapt', '540p', '720p', '1080p', '2k', '4k']
const musicSources = ['netease', 'qq', 'kuwo', 'kugou', 'bilibili']

const getPathValue = (source: unknown, path: string) => {
  return path.split('.').reduce<unknown>((current, key) => {
    return current && typeof current === 'object'
      ? (current as Record<string, unknown>)[key]
      : undefined
  }, source)
}

const validateNumberRule = (config: HiraConfig, rule: ValidationRule) => {
  const value = Number(getPathValue(config, rule.path))
  if (!Number.isFinite(value)) return `${rule.label} 必须是数字`
  if (rule.min !== undefined && value < rule.min) return `${rule.label} 必须在 ${rule.min} 到 ${rule.max} 之间`
  if (rule.max !== undefined && value > rule.max) return `${rule.label} 必须在 ${rule.min} 到 ${rule.max} 之间`
  return undefined
}

const validateEnum = (value: unknown, label: string, allowed: string[]) => {
  return allowed.includes(String(value))
    ? undefined
    : `${label} 必须是 ${allowed.join('、')} 之一`
}

export const validateHiraConfig = (config: HiraConfig): string[] => {
  return [
    ...numberRules.map(rule => validateNumberRule(config, rule)),
    validateEnum(config.music.defaultSource, 'music.defaultSource', musicSources),
    validateEnum(config.resolver.bilibili.codec, 'resolver.bilibili.codec', bilibiliCodecs),
    validateEnum(config.resolver.douyin.quality, 'resolver.douyin.quality', douyinQualities)
  ].filter((message): message is string => Boolean(message))
}
