import type { HiraConfig } from '@/types/config'

export const SENSITIVE_CONFIG_MASK = '********'

const sensitivePaths = [
  'music.cookies.netease',
  'music.cookies.qq',
  'music.cookies.kuwo',
  'music.cookies.kugou',
  'music.cookies.bilibili',
  'resolver.proxy',
  'resolver.cookies.weibo',
  'resolver.cookies.xiaoheihe',
  'resolver.cookies.douyin',
  'resolver.cookies.xiaohongshu',
  'resolver.cookies.bilibili',
  'translate.deeplxApi',
  'ai.apiKey'
] as const

type MutableRecord = Record<string, unknown>

const clone = <T>(value: T): T => structuredClone(value)

const getPath = (source: unknown, path: string) => path.split('.').reduce<unknown>((current, key) => {
  return current && typeof current === 'object' ? (current as MutableRecord)[key] : undefined
}, source)

const setPath = (source: unknown, path: string, value: unknown) => {
  const parts = path.split('.')
  let cursor = source as MutableRecord
  for (const part of parts.slice(0, -1)) {
    const next = cursor[part]
    if (!next || typeof next !== 'object' || Array.isArray(next)) cursor[part] = {}
    cursor = cursor[part] as MutableRecord
  }
  cursor[parts.at(-1)!] = value
}

export const maskSensitiveConfig = <T extends HiraConfig | Partial<HiraConfig>>(config: T): T => {
  const masked = clone(config)
  for (const path of sensitivePaths) {
    const value = getPath(masked, path)
    if (typeof value === 'string' && value.trim()) setPath(masked, path, SENSITIVE_CONFIG_MASK)
  }
  return masked
}

export const restoreMaskedSecrets = <T extends Partial<HiraConfig>>(current: HiraConfig, incoming: T): T => {
  const restored = clone(incoming)
  for (const path of sensitivePaths) {
    if (getPath(restored, path) !== SENSITIVE_CONFIG_MASK) continue
    const currentValue = getPath(current, path)
    if (typeof currentValue === 'string') setPath(restored, path, currentValue)
  }
  return restored
}
