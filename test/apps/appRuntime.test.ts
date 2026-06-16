import { describe, expect, it, vi } from 'vitest'

const configMock = vi.hoisted(() => ({
  app: {
    enabled: false,
    helpCommand: '#菜单',
    statusCommand: '#状态',
    replyPrefix: 'Hira'
  }
}))

vi.mock('@/config', () => ({
  Config: configMock
}))

describe('app runtime config', () => {
  it('builds help and status patterns from configured commands plus aliases', async () => {
    const { createConfiguredCommandRegExp } = await import('@/apps/runtime')

    const helpReg = createConfiguredCommandRegExp(configMock.app.helpCommand, ['hira\\s*帮助', 'hi\\s*帮助'])
    const statusReg = createConfiguredCommandRegExp(configMock.app.statusCommand, ['hira\\s*状态', 'hi\\s*状态'])

    expect(helpReg.test('#菜单')).toBe(true)
    expect(helpReg.test('菜单')).toBe(true)
    expect(helpReg.test('#Hira帮助')).toBe(true)
    expect(helpReg.test('#状态')).toBe(false)

    expect(statusReg.test('#状态')).toBe(true)
    expect(statusReg.test('状态')).toBe(true)
    expect(statusReg.test('#hi状态')).toBe(true)
    expect(statusReg.test('#菜单')).toBe(false)
  })

  it('exposes the app enabled flag for handlers', async () => {
    const { isHiraAppEnabled } = await import('@/apps/runtime')

    expect(isHiraAppEnabled()).toBe(false)
  })
})
