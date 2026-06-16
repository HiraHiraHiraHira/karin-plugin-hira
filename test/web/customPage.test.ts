import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { webConfig } from '@/web.config'

describe('Hira custom config page', () => {
  const readWebSource = () => {
    const sourceRoot = path.join(process.cwd(), 'web', 'src')
    const files: string[] = []
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const fullPath = path.join(dir, entry.name)
        if (entry.isDirectory()) {
          walk(fullPath)
          continue
        }
        if (/\.(ts|tsx)$/.test(entry.name)) files.push(fs.readFileSync(fullPath, 'utf8'))
      }
    }

    walk(sourceRoot)
    return files.join('\n')
  }

  const pathPattern = (fieldPath: string) => {
    const parts = fieldPath.split('.').map((part) => `'${part}'`).join('\\s*,\\s*')
    return new RegExp(`\\[\\s*${parts}\\s*\\]`)
  }

  it('exposes a KKK-style custom Karin config page', () => {
    expect(webConfig).toMatchObject({
      page: {
        url: '/hira/karin-config',
        title: 'Hira 配置管理',
        description: '使用 Hira 插件自带的配置管理页面'
      }
    })
  })

  it('ships the custom WebUI entry as a static resource', () => {
    const html = fs.readFileSync(path.join(process.cwd(), 'resources', 'web', 'index.html'), 'utf8')
    const apiSource = fs.readFileSync(path.join(process.cwd(), 'web', 'src', 'api', 'config.ts'), 'utf8')
    const panelSource = fs.readFileSync(path.join(process.cwd(), 'web', 'src', 'components', 'common', 'ConfigPanel.tsx'), 'utf8')

    expect(html).toContain('<div id="root"></div>')
    expect(html).toContain('/hira/assets/')
    expect(apiSource).toContain('/api/hira/v1')
    expect(panelSource).toContain('@heroui/react')
    expect(panelSource).toContain('Tabs.List')
  })

  it('exposes every default config field in the custom page', () => {
    const source = readWebSource()
    const requiredPaths = [
      'app.enabled',
      'app.helpCommand',
      'app.replyPrefix',
      'app.statusCommand',
      'music.enabled',
      'music.defaultSource',
      'music.listModeDefault',
      'music.pageSize',
      'music.sessionTtlSeconds',
      'music.voiceEnabled',
      'music.highQuality',
      'music.textFallback',
      'music.cookies.netease',
      'music.cookies.qq',
      'music.cookies.kuwo',
      'music.cookies.kugou',
      'music.cookies.bilibili',
      'music.api.neteaseBaseUrl',
      'music.api.qqTempApi',
      'resolver.enabled',
      'resolver.kkkCompat',
      'resolver.commentsEnabled',
      'resolver.priority',
      'resolver.maxVideoDurationSeconds',
      'resolver.bilibili.maxVideoDurationSeconds',
      'resolver.bilibili.quality',
      'resolver.bilibili.codec',
      'resolver.douyin.maxVideoDurationSeconds',
      'resolver.douyin.quality',
      'resolver.proxy',
      'resolver.cookies.weibo',
      'resolver.cookies.xiaoheihe',
      'resolver.cookies.douyin',
      'resolver.cookies.xiaohongshu',
      'resolver.cookies.bilibili',
      'resolver.generalApis',
      'runtime.tempRoot',
      'runtime.cleanupEnabled',
      'runtime.cleanupMaxAgeMinutes',
      'runtime.ffmpegPath',
      'runtime.ffprobePath',
      'runtime.downloadTimeoutSeconds',
      'light.enabled',
      'light.catApis',
      'light.buyerShowApis',
      'light.tiredApis',
      'light.medicineApi',
      'light.softwareApi',
      'translate.tencentApi',
      'translate.timeoutSeconds',
      'ai.maxInputChars'
    ]

    for (const fieldPath of requiredPaths) {
      expect(source).toMatch(pathPattern(fieldPath))
    }
  })
})
