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
})
