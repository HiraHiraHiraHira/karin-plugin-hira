import type { HiraConfig } from '@/types/config'
import { webFieldPathMap } from '@/web/components'

type FlatConfig = Record<string, unknown>

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export const flattenConfig = (config: Record<string, unknown>, prefix = ''): FlatConfig => {
  const result: FlatConfig = {}
  for (const [key, value] of Object.entries(config)) {
    const nextKey = prefix ? `${prefix}.${key}` : key
    if (isRecord(value)) {
      Object.assign(result, flattenConfig(value, nextKey))
    } else {
      result[nextKey] = value
    }
  }
  return result
}

export const unflattenConfig = (flat: FlatConfig) => {
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(flat)) {
    const parts = key.split('.').filter(Boolean)
    let cursor = result
    for (const part of parts.slice(0, -1)) {
      const current = cursor[part]
      if (!isRecord(current)) cursor[part] = {}
      cursor = cursor[part] as Record<string, unknown>
    }
    const last = parts.at(-1)
    if (last) cursor[last] = value
  }
  return result
}

const deepMerge = <T extends Record<string, unknown>>(base: T, patch: Record<string, unknown>): T => {
  const result: Record<string, unknown> = { ...base }
  for (const [key, value] of Object.entries(patch)) {
    const oldValue = result[key]
    if (isRecord(oldValue) && isRecord(value)) {
      result[key] = deepMerge(oldValue, value)
    } else {
      result[key] = value
    }
  }
  return result as T
}

const minutesToSeconds = (value: unknown) => {
  const minutes = Number(value)
  if (!Number.isFinite(minutes)) return value
  return Math.round(minutes * 60)
}

const webFieldValueTransforms: Record<string, (value: unknown) => unknown> = {
  resolverBilibiliMaxVideoDurationMinutes: minutesToSeconds,
  resolverDouyinMaxVideoDurationMinutes: minutesToSeconds
}

const remapWebFieldKeys = (value: unknown, result: FlatConfig = {}): FlatConfig => {
  if (Array.isArray(value)) {
    for (const item of value) remapWebFieldKeys(item, result)
    return result
  }

  if (!isRecord(value)) return result

  for (const [key, item] of Object.entries(value)) {
    const mappedKey = webFieldPathMap[key]
    if (mappedKey) {
      result[mappedKey] = webFieldValueTransforms[key]?.(item) ?? item
      continue
    }
    remapWebFieldKeys(item, result)
  }

  return result
}

export const normalizeWebConfigPatch = (patch: FlatConfig | Partial<HiraConfig>): FlatConfig | Partial<HiraConfig> => {
  if (isRecord(patch) && Object.keys(patch).some(key => key in webFieldPathMap || key === 'hiraConfig')) {
    return remapWebFieldKeys(patch)
  }
  return patch
}

export const mergeConfigPatch = (base: HiraConfig, patch: FlatConfig | Partial<HiraConfig>): HiraConfig => {
  const normalizedPatch = normalizeWebConfigPatch(patch)
  const nested = Object.keys(normalizedPatch).some(key => key.includes('.'))
    ? unflattenConfig(normalizedPatch as FlatConfig)
    : normalizedPatch as Record<string, unknown>
  return deepMerge(base as unknown as Record<string, unknown>, nested) as unknown as HiraConfig
}
