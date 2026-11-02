import { beforeEach, describe, expect, it, vi } from 'vitest'

import { acquireSummarySlot, getSummaryRateStateCount, resetSummaryRateStates } from '@/summary/service'

describe('summary 限流状态', () => {
  beforeEach(() => {
    resetSummaryRateStates()
  })

  it('限流状态条目数不会无限增长', () => {
    for (let index = 0; index < 600; index += 1) {
      const release = acquireSummarySlot(`user-${index}`)
      release()
    }

    expect(getSummaryRateStateCount()).toBeLessThanOrEqual(500)
  })

  it('窗口外的旧条目会被清理', () => {
    let now = 1_000_000
    const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => now)

    try {
      acquireSummarySlot('old')()
      expect(getSummaryRateStateCount()).toBe(1)

      // 超过 5 分钟窗口后再来一个新请求人，旧条目应被清掉
      now += 6 * 60_000
      acquireSummarySlot('new')()
      expect(getSummaryRateStateCount()).toBe(1)
    } finally {
      nowSpy.mockRestore()
    }
  })

  it('保持同一请求人 3 次的限流语义', () => {
    acquireSummarySlot('same')()
    acquireSummarySlot('same')()
    acquireSummarySlot('same')()

    expect(() => acquireSummarySlot('same')).toThrow('网页总结请求过于频繁')
  })
})
