import { describe, expect, it } from 'vitest'

import { defaultConfig } from '@/config/defaults'
import { validateConfig } from '../../web/src/components/common/config-panel/validation'

describe('custom WebUI validation', () => {
  it('blocks invalid values before save', () => {
    const errors = validateConfig({
      ...defaultConfig,
      music: {
        ...defaultConfig.music,
        pageSize: 30
      },
      resolver: {
        ...defaultConfig.resolver,
        bilibili: {
          ...defaultConfig.resolver.bilibili,
          maxVideoDurationSeconds: -60
        }
      },
      ai: {
        ...defaultConfig.ai,
        maxInputChars: 0
      }
    })

    expect(errors).toMatchObject({
      'music.pageSize': '必须在 1 到 20 之间',
      'resolver.bilibili.maxVideoDurationSeconds': '必须在 0 到 21600 之间',
      'ai.maxInputChars': '必须在 1000 到 200000 之间'
    })
  })
})
