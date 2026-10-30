import { describe, expect, it } from 'vitest'

import { helpReg } from '@/apps/help'

describe('help command patterns', () => {
  it('accepts Hira help aliases', () => {
    expect(helpReg.test('#Hira帮助')).toBe(true)
    expect(helpReg.test('hira帮助')).toBe(true)
    expect(helpReg.test('#hi帮助')).toBe(true)
  })

  it('accepts menu/help/instruction aliases', () => {
    for (const alias of ['菜单', 'help', '说明', '功能', '指令', '使用说明']) {
      expect(helpReg.test(alias)).toBe(true)
      expect(helpReg.test(`#${alias}`)).toBe(true)
    }
    expect(helpReg.test('#猫图')).toBe(false)
  })
})
