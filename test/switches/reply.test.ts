import { describe, expect, it, vi } from 'vitest'

// 只测回执文案，不碰存储
const testBase = vi.hoisted(() => `${process.cwd()}/test-output/.tmp-switch-reply-${process.pid}-${Date.now()}`)
vi.mock('node-karin/root', () => ({ karinPathBase: testBase, karinPathTemp: `${testBase}/temp` }))

vi.mock('node-karin', async importOriginal => {
  const actual = await importOriginal<typeof import('node-karin')>()
  const patched = { ...actual.default, command: vi.fn((_r: unknown, h: unknown) => ({ handler: h })) }
  return { ...actual, default: patched, karin: patched, render: actual.render }
})

describe('开关回执文案', () => {
  it('回执不以模块名开头（避免同群另一个 Bot 误认成点歌命令）', async () => {
    const { toggleText } = await import('@/apps/switches')

    expect(toggleText('点歌', true)).toBe('已开启点歌')
    expect(toggleText('点歌', false)).toBe('已关闭点歌')

    for (const [label, enabled] of [['点歌', true], ['B站解析', false], ['翻译', true]] as const) {
      const text = toggleText(label, enabled)
      expect(text.startsWith(label)).toBe(false)
      // 不是以模块名开头，就不会被点歌/解析等命令正则命中
      expect(/^#?(?:点歌|来首|解析)/.test(text)).toBe(false)
    }
  })
})
