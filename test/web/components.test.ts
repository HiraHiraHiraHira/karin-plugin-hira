import { describe, expect, it } from 'vitest'

import { createWebConfigComponents } from '@/web/components'

type ComponentNode = Record<string, unknown> & { children?: ComponentNode[] }

const flattenComponents = (components: ComponentNode[]): ComponentNode[] => {
  return components.flatMap(component => [
    component,
    ...flattenComponents(Array.isArray(component.children) ? component.children as ComponentNode[] : [])
  ])
}

const findComponent = (key: string): ComponentNode | undefined => {
  return flattenComponents(createWebConfigComponents() as unknown as ComponentNode[]).find(component => component.key === key)
}

const allKeys = (): string[] => {
  return flattenComponents(createWebConfigComponents() as unknown as ComponentNode[])
    .map(component => component.key)
    .filter((key): key is string => typeof key === 'string')
}

describe('createWebConfigComponents', () => {
  it('builds Karin WebUI components for Hira settings', () => {
    const components = createWebConfigComponents()
    const serialized = JSON.stringify(components)

    expect(serialized).toContain('appEnabled')
    expect(serialized).toContain('musicDefaultSource')
    expect(serialized).toContain('resolverKkkCompat')
    expect(serialized).toContain('resolverPlatformBilibili')
    expect(serialized).toContain('resolverPlatformXiaohongshu')
    expect(serialized).toContain('resolverSendingContentForwardEnabled')
    expect(serialized).toContain('resolverSendingVideoFailureFallbackEnabled')
    expect(serialized).toContain('resolverMediaDedupeImages')
    expect(serialized).toContain('resolverMediaFilterLowQualityImages')
    expect(serialized).toContain('resolverMediaInlinePreviewCover')
    expect(serialized).toContain('resolverDiagnosticsStageLogsEnabled')
    expect(serialized).toContain('resolverDiagnosticsVerboseLogsEnabled')
    expect(serialized).toContain('resolverMaxVideoDurationMinutes')
    expect(serialized).toContain('resolverBilibiliMaxVideoDurationMinutes')
    expect(serialized).toContain('resolverBilibiliQuality')
    expect(serialized).toContain('resolverBilibiliCodec')
    expect(serialized).toContain('resolverDouyinMaxVideoDurationMinutes')
    expect(serialized).toContain('resolverDouyinQuality')
    expect(serialized).toContain('resolverCookiesDouyin')
    expect(serialized).toContain('resolverCookiesXiaohongshu')
    expect(serialized).toContain('resolverCookiesBilibili')
    expect(serialized).toContain('aiSummaryEnabled')
    expect(serialized).not.toContain('youtube')
  })

  it('names and opens the top-level Hira settings panel', () => {
    expect(findComponent('hiraConfig')).toMatchObject({
      label: 'Hira 插件配置',
      title: 'Hira 插件配置',
      selectionMode: 'multiple',
      variant: 'splitted',
      showDivider: false,
      keepContentMounted: true,
      defaultSelectedKeys: ['hiraApp', 'hiraMusic', 'hiraResolver', 'hiraRuntime', 'hiraExtra']
    })
  })

  it('uses platform resolver wording and useful accordion subtitles', () => {
    const serialized = JSON.stringify(createWebConfigComponents())

    expect(serialized).toContain('多平台解析')
    expect(serialized).not.toContain('补充解析')
    expect(findComponent('hiraResolver')).toMatchObject({
      title: '多平台解析',
      subtitle: '管理微博、贴吧、小黑盒、小红书、抖音、B站等分享链接解析。'
    })
    expect(findComponent('resolverEnabled')).toMatchObject({
      label: '启用多平台解析',
      description: '开启后自动识别支持的平台分享链接。'
    })
  })

  it('does not pin switches to a controlled false state', () => {
    const switchKeys = [
      'appEnabled',
      'musicEnabled',
      'resolverEnabled',
      'resolverKkkCompat',
      'resolverCommentsEnabled',
      'resolverPlatformBilibili',
      'resolverPlatformDouyin',
      'resolverPlatformKuaishou',
      'resolverPlatformWeibo',
      'resolverPlatformTieba',
      'resolverPlatformXiaoheihe',
      'resolverPlatformXiaohongshu',
      'resolverPlatformGeneral',
      'resolverSendingContentForwardEnabled',
      'resolverSendingVideoFailureFallbackEnabled',
      'resolverMediaDedupeImages',
      'resolverMediaFilterLowQualityImages',
      'resolverMediaInlinePreviewCover',
      'resolverDiagnosticsStageLogsEnabled',
      'resolverDiagnosticsVerboseLogsEnabled',
      'runtimeCleanupEnabled',
      'lightEnabled',
      'translateEnabled',
      'aiSummaryEnabled'
    ]

    for (const key of switchKeys) {
      expect(findComponent(key)).not.toHaveProperty('isSelected')
    }
  })

  it('uses dotless component keys for Karin react-hook-form paths', () => {
    expect(allKeys().filter(key => key.includes('.'))).toEqual([])
  })

  it('keeps render metadata on the default music source select', () => {
    const component = findComponent('musicDefaultSource')

    expect(component).toMatchObject({
      label: '默认音乐源',
      defaultValue: 'qq',
      componentType: 'select'
    })
  })

  it('allows optional endpoint and credential fields to be left empty', () => {
    const optionalInputKeys = [
      'musicCookiesNetease',
      'musicCookiesQq',
      'musicCookiesBilibili',
      'resolverProxy',
      'resolverCookiesWeibo',
      'resolverCookiesXiaoheihe',
      'resolverCookiesDouyin',
      'resolverCookiesXiaohongshu',
      'resolverCookiesBilibili',
      'runtimeTempRoot',
      'translateDeeplxApi',
      'aiApiKey'
    ]

    for (const key of optionalInputKeys) {
      expect(findComponent(key)).toMatchObject({
        componentType: 'input',
        isRequired: false
      })
    }
  })

  it('allows numeric defaults used by resolver and runtime settings', () => {
    expect(findComponent('resolverPriority')).toMatchObject({
      defaultValue: '900',
      rules: [{ min: 0, max: 9999 }]
    })
    expect(findComponent('resolverMaxVideoDurationMinutes')).toMatchObject({
      label: '通用视频上限分钟',
      defaultValue: '8',
      rules: [{ min: 0, max: 360 }]
    })
    expect(findComponent('resolverBilibiliMaxVideoDurationMinutes')).toMatchObject({
      label: 'B站下载上限分钟',
      defaultValue: '8',
      rules: [{ min: 0, max: 360 }]
    })
    expect(findComponent('resolverDouyinMaxVideoDurationMinutes')).toMatchObject({
      label: '抖音下载上限分钟',
      defaultValue: '8',
      rules: [{ min: 0, max: 360 }]
    })
    expect(findComponent('runtimeCleanupMaxAgeMinutes')).toMatchObject({
      defaultValue: '120',
      rules: [{ min: 1, max: 10080 }]
    })
  })

  it('exposes video quality controls for native resolvers', () => {
    expect(findComponent('resolverBilibiliQuality')).toMatchObject({
      label: 'B站下载画质',
      defaultValue: '64',
      componentType: 'select'
    })
    expect(findComponent('resolverBilibiliCodec')).toMatchObject({
      label: 'B站视频编码',
      defaultValue: 'auto',
      componentType: 'select'
    })
    expect(findComponent('resolverDouyinQuality')).toMatchObject({
      label: '抖音视频清晰度',
      defaultValue: '1080p',
      componentType: 'select'
    })
  })
})
