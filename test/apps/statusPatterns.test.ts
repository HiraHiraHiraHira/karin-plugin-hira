import { describe, expect, it } from 'vitest'

import { cleanupReg, statusReg } from '@/apps/status'

describe('status command patterns', () => {
  it('accepts Hira status and cleanup aliases', () => {
    expect(statusReg.test('#Hira状态')).toBe(true)
    expect(statusReg.test('hira状态')).toBe(true)
    expect(statusReg.test('#hi状态')).toBe(true)

    expect(cleanupReg.test('#Hira清理垃圾')).toBe(true)
    expect(cleanupReg.test('hira清理垃圾')).toBe(true)
    expect(cleanupReg.test('#hi清理垃圾')).toBe(true)
    // 裸词不再触发, 避免误吞普通聊天.
    expect(cleanupReg.test('#清理垃圾')).toBe(false)
    expect(cleanupReg.test('清理垃圾')).toBe(false)
  })
})
