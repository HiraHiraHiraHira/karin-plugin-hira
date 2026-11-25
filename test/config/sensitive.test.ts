import { describe, expect, it } from 'vitest'

import { defaultConfig } from '@/config/defaults'
import { maskSensitiveConfig, restoreMaskedSecrets, SENSITIVE_CONFIG_MASK } from '@/config/sensitive'

describe('sensitive config handling', () => {
  it('masks secrets without mutating the source and restores unchanged masked fields', () => {
    const config = structuredClone(defaultConfig)
    config.music.cookies.netease = 'MUSIC_U=secret'
    config.music.card.ark.key = 'ark-secret-key'
    config.music.bilibili.appKey = 'test-app-key'
    config.music.bilibili.appSecret = 'test-app-secret'
    config.resolver.proxy = 'http://user:password@127.0.0.1:7890'
    config.resolver.cookies.bilibili = 'SESSDATA=secret'
    config.translate.deeplxApi = 'https://translate.example.test/secret'
    config.ai.apiKey = 'sk-secret'

    const masked = maskSensitiveConfig(config)

    expect(masked.music.cookies.netease).toBe(SENSITIVE_CONFIG_MASK)
    expect(masked.music.card.ark.key).toBe(SENSITIVE_CONFIG_MASK)
    expect(masked.music.bilibili.appKey).toBe(SENSITIVE_CONFIG_MASK)
    expect(masked.music.bilibili.appSecret).toBe(SENSITIVE_CONFIG_MASK)
    expect(masked.resolver.proxy).toBe(SENSITIVE_CONFIG_MASK)
    expect(masked.resolver.cookies.bilibili).toBe(SENSITIVE_CONFIG_MASK)
    expect(masked.translate.deeplxApi).toBe(SENSITIVE_CONFIG_MASK)
    expect(masked.ai.apiKey).toBe(SENSITIVE_CONFIG_MASK)
    expect(masked.music.api.neteaseBaseUrl).toBe(config.music.api.neteaseBaseUrl)
    expect(config.ai.apiKey).toBe('sk-secret')

    expect(restoreMaskedSecrets(config, masked)).toEqual(config)
  })

  it('allows an explicitly blank secret to clear the stored value', () => {
    const config = structuredClone(defaultConfig)
    config.ai.apiKey = 'sk-secret'
    const incoming = maskSensitiveConfig(config)
    incoming.ai.apiKey = ''

    expect(restoreMaskedSecrets(config, incoming).ai.apiKey).toBe('')
  })

  it('masks every secret/key/cookie/token string field in defaultConfig', () => {
    const config = structuredClone(defaultConfig)
    const secretPaths: string[] = []
    const populate = (node: Record<string, unknown>, prefix: string) => {
      for (const [key, value] of Object.entries(node)) {
        const fullPath = prefix ? `${prefix}.${key}` : key
        if (value && typeof value === 'object' && !Array.isArray(value)) {
          populate(value as Record<string, unknown>, fullPath)
        } else if (typeof value === 'string') {
          if (/(?:^|\.)cookies\.|(?:^|\.)(?:key|secret|token|apiKey|appKey|appSecret)$/i.test(fullPath)) {
            node[key] = `secret-value-${fullPath}`
            secretPaths.push(fullPath)
          }
        }
      }
    }
    populate(config as unknown as Record<string, unknown>, '')

    const masked = maskSensitiveConfig(config) as unknown as Record<string, unknown>
    const read = (p: string) => p.split('.').reduce<unknown>((cur, k) => (cur as Record<string, unknown>)[k], masked)
    for (const p of secretPaths) {
      expect(read(p), `${p} should be masked`).toBe(SENSITIVE_CONFIG_MASK)
    }
  })
})
