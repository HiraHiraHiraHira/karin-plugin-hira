import { describe, expect, it } from 'vitest'

import { shouldDeferSelection } from '@/music/selection'

describe('shouldDeferSelection', () => {
  it('defers bare numeric messages when no music session exists', () => {
    expect(shouldDeferSelection('1', false)).toBe(true)
    expect(shouldDeferSelection('  23  ', false)).toBe(true)
  })

  it('does not defer explicit listen commands', () => {
    expect(shouldDeferSelection('#听1', false)).toBe(false)
    expect(shouldDeferSelection('#播放1', false)).toBe(false)
  })

  it('does not defer bare numeric messages when a session exists', () => {
    expect(shouldDeferSelection('1', true)).toBe(false)
  })
})
