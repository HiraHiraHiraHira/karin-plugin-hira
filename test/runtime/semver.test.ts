import { describe, expect, it } from 'vitest'

import { isSemverGreater } from '@/runtime/semver'

describe('isSemverGreater', () => {
  it('compares stable versions and ignores a leading v', () => {
    expect(isSemverGreater('v0.2.0', '0.1.9')).toBe(true)
    expect(isSemverGreater('0.1.0', '0.1.0')).toBe(false)
    expect(isSemverGreater('0.1.0', '0.2.0')).toBe(false)
  })

  it('treats stable releases as newer than prereleases of the same core', () => {
    expect(isSemverGreater('1.0.0', '1.0.0-beta.2')).toBe(true)
    expect(isSemverGreater('1.0.0-beta.2', '1.0.0')).toBe(false)
    expect(isSemverGreater('1.0.0-beta.11', '1.0.0-beta.2')).toBe(true)
  })
})
