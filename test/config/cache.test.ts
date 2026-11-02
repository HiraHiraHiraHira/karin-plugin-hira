import fs from 'node:fs'
import path from 'node:path'

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

// 把 karinPathBase 指到仓库内被 gitignore 的 test-output 下，避免污染真实配置目录
const testBase = vi.hoisted(() => `${process.cwd()}/test-output/.tmp-config-cache-${process.pid}-${Date.now()}`)

vi.mock('node-karin/root', () => ({ karinPathBase: testBase }))

const configDir = path.join(testBase, 'karin-plugin-hira', 'config')

const writeYaml = (name: string, content: string) => {
  fs.mkdirSync(configDir, { recursive: true })
  fs.writeFileSync(path.join(configDir, `${name}.yaml`), content, 'utf8')
}

describe('readConfig 缓存', () => {
  beforeAll(() => {
    fs.rmSync(testBase, { recursive: true, force: true })
    fs.mkdirSync(configDir, { recursive: true })
  })

  afterAll(() => {
    fs.rmSync(testBase, { recursive: true, force: true })
  })

  it('命中缓存时仍返回全新对象，且调用方改不坏缓存', async () => {
    writeYaml('app', 'enabled: false\n')
    const { Config } = await import('@/config')

    const first = Config.app
    const second = Config.app

    expect(first.enabled).toBe(false)
    expect(first).not.toBe(second)
    expect(first).toEqual(second)

    first.enabled = true
    first.replyPrefix = '被调用方改坏的前缀'
    expect(Config.app.enabled).toBe(false)
    expect(Config.app.replyPrefix).toBe('Hira')
  })

  it('文件内容变化（size 变化）后能读到新值', async () => {
    const { Config } = await import('@/config')

    writeYaml('app', 'enabled: false\n')
    expect(Config.app.enabled).toBe(false)

    writeYaml('app', "enabled: true\nhelpCommand: '#新帮助命令'\n")
    expect(Config.app.enabled).toBe(true)
    expect(Config.app.helpCommand).toBe('#新帮助命令')
  })

  it('仅 mtime 变化（内容等长）也能读到新值', async () => {
    const { Config } = await import('@/config')
    const file = path.join(configDir, 'app.yaml')

    writeYaml('app', "helpCommand: 'AAAA'\n")
    // 先把 mtime 拨到一年前，再写入等长的新内容，保证 mtimeMs 一定不同
    const past = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000)
    fs.utimesSync(file, past, past)
    expect(Config.app.helpCommand).toBe('AAAA')

    writeYaml('app', "helpCommand: 'BBBB'\n")
    expect(Config.app.helpCommand).toBe('BBBB')
  })

  it('文件不存在时回退到默认配置', async () => {
    const { Config } = await import('@/config')
    fs.rmSync(path.join(configDir, 'translate.yaml'), { force: true })

    expect(Config.translate.enabled).toBe(true)
    expect(Config.translate.timeoutSeconds).toBe(15)
  })
})
