import { describe, expect, it } from 'vitest'

import { defaultConfig } from '@/config/defaults'
import { maskSensitiveConfig, restoreMaskedSecrets, SENSITIVE_CONFIG_MASK } from '@/config/sensitive'

describe('sensitive config handling', () => {
  it('masks secrets without mutating the source and restores unchanged masked fields', () => {
    const config = structuredClone(defaultConfig)
    config.music.cookies.netease = 'MUSIC_U=secret'
    config.resolver.proxy = 'http://user:password@127.0.0.1:7890'
    config.resolver.cookies.bilibili = 'SESSDATA=secret'
    config.translate.deeplxApi = 'https://translate.example.test/secret'
    config.ai.apiKey = 'sk-secret'

    const masked = maskSensitiveConfig(config)

    expect(masked.music.cookies.netease).toBe(SENSITIVE_CONFIG_MASK)
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
})
