import { describe, expect, it } from 'vitest'

import { defaultConfig } from '@/config/defaults'
import { validateHiraConfig } from '@/config/validation'

describe('Hira config validation', () => {
  it('accepts the default config', () => {
    expect(validateHiraConfig(defaultConfig)).toEqual([])
  })

  it('rejects invalid numeric ranges and enum values', () => {
    expect(validateHiraConfig({
      ...defaultConfig,
      music: {
        ...defaultConfig.music,
        pageSize: 0
      },
      resolver: {
        ...defaultConfig.resolver,
        bilibili: {
          ...defaultConfig.resolver.bilibili,
          codec: 'vp9' as never
        }
      },
      runtime: {
        ...defaultConfig.runtime,
        downloadTimeoutSeconds: 1
      }
    })).toEqual(expect.arrayContaining([
      'music.pageSize 必须在 1 到 20 之间',
      'resolver.bilibili.codec 必须是 auto、av1、hevc、avc 之一',
      'runtime.downloadTimeoutSeconds 必须在 5 到 600 之间'
    ]))
  })

  it('rejects unknown keys and unsafe API URLs while allowing proxy credentials', () => {
    const invalid = structuredClone(defaultConfig) as typeof defaultConfig & { unexpected?: boolean }
    invalid.unexpected = true
    invalid.ai.apiBaseUrl = 'file:///tmp/secret'

    expect(validateHiraConfig(invalid)).toEqual(expect.arrayContaining([
      'config.unexpected 不是受支持的配置项',
      'ai.apiBaseUrl 只允许 http 或 https 地址'
    ]))

    const withAuthenticatedProxy = structuredClone(defaultConfig)
    withAuthenticatedProxy.resolver.proxy = 'http://user:password@127.0.0.1:7890'
    expect(validateHiraConfig(withAuthenticatedProxy)).toEqual([])
  })

  it('returns shape errors instead of throwing on malformed input', () => {
    expect(() => validateHiraConfig({} as never)).not.toThrow()
    expect(validateHiraConfig({} as never)).toEqual(expect.arrayContaining([
      'config.app 不能为空',
      'config.music 不能为空'
    ]))
  })
})
