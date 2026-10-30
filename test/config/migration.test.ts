import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { beforeAll, describe, expect, it } from 'vitest'
import YAML from 'yaml'

/**
 * 与 saveModule.test 相同的隔离方式：`@/config` 在模块加载时读取 `HIRA_CONFIG_ROOT`，
 * 因此必须在首次导入前落位，只能运行时动态 import。
 */
const isolatedRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'hira-migration-'))

beforeAll(() => {
  process.env.HIRA_CONFIG_ROOT = isolatedRoot
})

const writeModule = (name: string, value: Record<string, unknown>) => {
  fs.writeFileSync(path.join(isolatedRoot, `${name}.yaml`), YAML.stringify(value))
}

describe('legacy config migration', () => {
  it('rewrites dead legacy defaults so upgraded installs still work', async () => {
    writeModule('translate', {
      enabled: true,
      deeplxApi: '',
      tencentApi: 'https://api.interpreter.caiyunai.com/v1/translator',
      timeoutSeconds: 15
    })
    writeModule('light', {
      enabled: true,
      catApis: ['https://shibe.online/api/cats?count=1'],
      buyerShowApis: ['https://api.vvhan.com/api/tao'],
      tiredApis: ['https://api.vvhan.com/api/wallpaper/views'],
      medicineApi: 'https://server.dayi.org.cn/api/search?keyword={keyword}&pageNo=1&pageSize=10',
      softwareApi: ''
    })

    const { Config } = await import('@/config')

    expect(Config.translate.tencentApi).toBe('https://transmart.qq.com/api/imt')
    expect(Config.light.buyerShowApis).toEqual(['https://api.suyanw.cn/api/tbmjx.php?return=json'])
    expect(Config.light.tiredApis).toEqual([
      'https://imgapi.cn/cos2.php?return=jsonpro',
      'https://imgapi.cn/cos.php?return=jsonpro'
    ])
  })

  it('keeps user-customized endpoints untouched', async () => {
    writeModule('translate', {
      enabled: true,
      deeplxApi: 'https://deeplx.example.test/translate',
      tencentApi: 'https://my-proxy.example.test/translate',
      timeoutSeconds: 20
    })
    writeModule('light', {
      enabled: true,
      catApis: [],
      buyerShowApis: ['https://custom.example.test/buyer'],
      tiredApis: ['https://custom.example.test/tired'],
      medicineApi: 'https://custom.example.test/med?k={keyword}',
      softwareApi: ''
    })

    const { Config } = await import('@/config')

    expect(Config.translate.tencentApi).toBe('https://my-proxy.example.test/translate')
    expect(Config.light.buyerShowApis).toEqual(['https://custom.example.test/buyer'])
    expect(Config.light.tiredApis).toEqual(['https://custom.example.test/tired'])
  })
})
