import type { ConfigType } from '../../../types/config'

type NumberRule = {
  path: string
  min: number
  max: number
}

const numberRules: NumberRule[] = [
  { path: 'music.pageSize', min: 1, max: 20 },
  { path: 'music.sessionTtlSeconds', min: 30, max: 3600 },
  { path: 'resolver.priority', min: 0, max: 9999 },
  { path: 'resolver.maxVideoDurationSeconds', min: 0, max: 21600 },
  { path: 'resolver.bilibili.maxVideoDurationSeconds', min: 0, max: 21600 },
  { path: 'resolver.douyin.maxVideoDurationSeconds', min: 0, max: 21600 },
  { path: 'runtime.cleanupMaxAgeMinutes', min: 1, max: 10080 },
  { path: 'runtime.downloadTimeoutSeconds', min: 5, max: 600 },
  { path: 'translate.timeoutSeconds', min: 1, max: 120 },
  { path: 'ai.maxInputChars', min: 1000, max: 200000 }
]

const enumRules = [
  { path: 'music.defaultSource', values: ['netease', 'qq', 'kuwo', 'kugou', 'bilibili'] },
  { path: 'resolver.bilibili.codec', values: ['auto', 'av1', 'hevc', 'avc'] },
  { path: 'resolver.douyin.quality', values: ['adapt', '540p', '720p', '1080p', '2k', '4k'] }
]

const getPathValue = (source: unknown, path: string) => {
  return path.split('.').reduce<unknown>((current, key) => {
    return current && typeof current === 'object'
      ? (current as Record<string, unknown>)[key]
      : undefined
  }, source)
}

export const validateConfig = (config: ConfigType | null): Record<string, string> => {
  if (!config) return {}

  const errors: Record<string, string> = {}

  for (const rule of numberRules) {
    const value = Number(getPathValue(config, rule.path))
    if (!Number.isFinite(value) || value < rule.min || value > rule.max) {
      errors[rule.path] = `必须在 ${rule.min} 到 ${rule.max} 之间`
    }
  }

  for (const rule of enumRules) {
    if (!rule.values.includes(String(getPathValue(config, rule.path)))) {
      errors[rule.path] = `必须是 ${rule.values.join('、')} 之一`
    }
  }

  return errors
}
