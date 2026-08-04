import { defaultConfig } from './defaults'
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
  { path: 'runtime.maxVideoFileSizeBytes', label: 'runtime.maxVideoFileSizeBytes', min: 1 * 1024 * 1024, max: 2 * 1024 * 1024 * 1024 },
  { path: 'runtime.maxPreviewCoverBytes', label: 'runtime.maxPreviewCoverBytes', min: 64 * 1024, max: 50 * 1024 * 1024 },
  { path: 'runtime.maxTempBytes', label: 'runtime.maxTempBytes', min: 100 * 1024 * 1024, max: 20 * 1024 * 1024 * 1024 },
  { path: 'translate.timeoutSeconds', label: 'translate.timeoutSeconds', min: 1, max: 120 },
  { path: 'ai.maxInputChars', label: 'ai.maxInputChars', min: 1000, max: 200000 }
]

const bilibiliCodecs = ['auto', 'av1', 'hevc', 'avc']
const douyinQualities = ['adapt', '540p', '720p', '1080p', '2k', '4k']
const musicSources = ['netease', 'qq', 'kuwo', 'kugou', 'bilibili']

const urlPaths: Array<{ path: string, allowEmpty?: boolean, allowCredentials?: boolean }> = [
  { path: 'music.api.neteaseBaseUrl' },
  { path: 'music.api.qqTempApi' },
  { path: 'resolver.proxy', allowEmpty: true, allowCredentials: true },
  { path: 'resolver.generalApis', allowEmpty: true },
  { path: 'light.catApis', allowEmpty: true },
  { path: 'light.buyerShowApis', allowEmpty: true },
  { path: 'light.tiredApis', allowEmpty: true },
  { path: 'light.medicineApi' },
  { path: 'light.softwareApi' },
  { path: 'translate.deeplxApi', allowEmpty: true },
  { path: 'translate.tencentApi' },
  { path: 'ai.apiBaseUrl' }
]

const getPathValue = (source: unknown, path: string) => {
  return path.split('.').reduce<unknown>((current, key) => {
    return current && typeof current === 'object'
      ? (current as Record<string, unknown>)[key]
      : undefined
  }, source)
}

const isRecord = (value: unknown): value is Record<string, unknown> => (
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)
)

const validateShape = (value: unknown, schema: unknown, path: string, errors: string[]) => {
  if (Array.isArray(schema)) {
    if (!Array.isArray(value)) {
      errors.push(`${path} 必须是数组`)
      return
    }
    const itemSchema = schema[0]
    value.forEach((item, index) => validateShape(item, itemSchema, `${path}[${index}]`, errors))
    return
  }

  if (isRecord(schema)) {
    if (!isRecord(value)) {
      errors.push(`${path} 必须是对象`)
      return
    }
    for (const key of Object.keys(value)) {
      if (!(key in schema)) errors.push(`${path}.${key} 不是受支持的配置项`)
    }
    for (const [key, schemaValue] of Object.entries(schema)) {
      if (!(key in value)) {
        errors.push(`${path}.${key} 不能为空`)
        continue
      }
      validateShape(value[key], schemaValue, `${path}.${key}`, errors)
    }
    return
  }

  if (typeof value !== typeof schema) {
    errors.push(`${path} 类型错误`)
    return
  }
  if (typeof value === 'number' && !Number.isFinite(value)) errors.push(`${path} 必须是有限数字`)
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

const normalizeUrlTemplate = (value: string) => value.replace(/\{[^}]+\}/g, 'placeholder')

const validateHttpUrl = (value: unknown, label: string, allowEmpty: boolean, allowCredentials = false) => {
  if (typeof value !== 'string') return `${label} 必须是字符串`
  const trimmed = value.trim()
  if (!trimmed && allowEmpty) return undefined
  if (!trimmed) return `${label} 不能为空`
  try {
    const url = new URL(normalizeUrlTemplate(trimmed))
    if (!['http:', 'https:'].includes(url.protocol)) return `${label} 只允许 http 或 https 地址`
    if (!allowCredentials && (url.username || url.password)) return `${label} 不应在地址中直接包含账号密码`
  } catch {
    return `${label} 必须是有效的 http(s) 地址`
  }
  return undefined
}

const validateUrlPath = (config: HiraConfig, rule: { path: string, allowEmpty?: boolean, allowCredentials?: boolean }) => {
  const value = getPathValue(config, rule.path)
  if (Array.isArray(value)) {
    return value.map((item, index) => validateHttpUrl(item, `${rule.path}[${index}]`, Boolean(rule.allowEmpty), Boolean(rule.allowCredentials)))
  }
  return [validateHttpUrl(value, rule.path, Boolean(rule.allowEmpty), Boolean(rule.allowCredentials))]
}

export const validateHiraConfig = (config: HiraConfig): string[] => {
  const shapeErrors: string[] = []
  validateShape(config, defaultConfig, 'config', shapeErrors)

  return [
    ...shapeErrors,
    ...numberRules.map(rule => validateNumberRule(config, rule)),
    validateEnum(getPathValue(config, 'music.defaultSource'), 'music.defaultSource', musicSources),
    validateEnum(getPathValue(config, 'resolver.bilibili.codec'), 'resolver.bilibili.codec', bilibiliCodecs),
    validateEnum(getPathValue(config, 'resolver.douyin.quality'), 'resolver.douyin.quality', douyinQualities),
    ...urlPaths.flatMap(rule => validateUrlPath(config, rule))
  ].filter((message): message is string => Boolean(message))
}
