import { describe, expect, it } from 'vitest'

import { isNpmRegistrySpec } from '@/apps/installSource'

describe('isNpmRegistrySpec', () => {
  it('treats versions, ranges, tags and npm aliases as registry installs', () => {
    for (const spec of ['1.2.3', '^0.1.0', '~0.1.0', '>=1.0.0', 'latest', 'beta', 'npm:karin-plugin-hira@^0.1.0']) {
      expect(isNpmRegistrySpec(spec), spec).toBe(true)
    }
  })

  it('treats local, git and url installs as non-registry', () => {
    for (const spec of [
      undefined,
      '',
      'file:../karin-plugin-hira',
      'link:../karin-plugin-hira',
      'workspace:*',
      'github:Hira/karin-plugin-hira',
      'git+https://github.com/Hira/karin-plugin-hira.git',
      'Hira/karin-plugin-hira',
      'https://example.com/karin-plugin-hira.tgz',
      './karin-plugin-hira',
      'D:/plugins/karin-plugin-hira'
    ]) {
      expect(isNpmRegistrySpec(spec), String(spec)).toBe(false)
    }
  })
})
