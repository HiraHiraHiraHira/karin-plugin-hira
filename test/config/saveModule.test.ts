import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { beforeAll, describe, expect, it } from 'vitest'
import YAML from 'yaml'

/**
 * 本文件独立于其它测试：`@/config` 在模块加载时读取 `HIRA_CONFIG_ROOT`，
 * 这里指向一个专用的空目录，避免写入全局 vitest 共享 tmpdir 后污染
 * 后续（或并行 fork 里的）依赖默认配置的断言。
 *
 * 规则豁免：`HIRA_CONFIG_ROOT` 必须在 `@/config` 首次导入前落位，
 * 而该路径只能在运行时生成，因此用 `await import()` 而非静态 import。
 */
const isolatedRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'hira-save-module-'))

beforeAll(() => {
  process.env.HIRA_CONFIG_ROOT = isolatedRoot
})

describe('saveConfigModule', () => {
  it('drops keys removed from the default schema instead of persisting them', async () => {
    const { readAllConfig: freshReadAllConfig, saveConfigModule: freshSaveConfigModule } =
      await import('@/config')

    const music = freshReadAllConfig().music
    // 旧版本写过的键：类型上已经删除，但真实用户 YAML 里仍然存在。
    const legacy = { ...music, textFallback: true } as typeof music

    freshSaveConfigModule('music', legacy)

    const file = path.join(isolatedRoot, 'music.yaml')
    const written = YAML.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>
    expect(written).not.toHaveProperty('textFallback')
    expect(written.highQuality).toBe(music.highQuality)
    expect(written.cookies).toEqual(music.cookies)
  })

  it('coerces numeric strings for number fields and still falls back on garbage', async () => {
    const { readAllConfig: freshReadAllConfig, saveConfigModule: freshSaveConfigModule } =
      await import('@/config')

    const music = freshReadAllConfig().music
    // 手改 YAML 时数字常被写成字符串，按默认值 schema 应转成数字而不是回退默认值。
    freshSaveConfigModule('music', { ...music, pageSize: '60' } as unknown as typeof music)

    const file = path.join(isolatedRoot, 'music.yaml')
    const written = YAML.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>
    expect(written.pageSize).toBe(60)

    freshSaveConfigModule('music', { ...music, pageSize: '六十' } as unknown as typeof music)
    const fallback = YAML.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>
    expect(fallback.pageSize).toBe(music.pageSize)
  })

  it('leaves the shared vitest config dir untouched', () => {
    const sharedDir = path.join(os.tmpdir(), 'karin-plugin-hira-vitest-config')
    expect(fs.existsSync(path.join(sharedDir, 'music.yaml'))).toBe(false)
  })
})
