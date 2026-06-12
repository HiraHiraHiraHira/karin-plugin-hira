import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { cleanupOldFiles, ensureTempDir, isSubPath } from '@/runtime/temp'

describe('runtime temp helpers', () => {
  it('creates named temp directories under the configured root', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hira-temp-'))
    const dir = ensureTempDir(root, 'music')

    expect(fs.existsSync(dir)).toBe(true)
    expect(isSubPath(root, dir)).toBe(true)
    expect(path.basename(dir)).toBe('music')
  })

  it('only cleans files older than the cutoff and reports deleted counts', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hira-clean-'))
    const oldFile = path.join(root, 'old.tmp')
    const newFile = path.join(root, 'new.tmp')
    fs.writeFileSync(oldFile, 'old')
    fs.writeFileSync(newFile, 'new')
    const oldTime = new Date(Date.now() - 10_000)
    fs.utimesSync(oldFile, oldTime, oldTime)

    const result = cleanupOldFiles(root, Date.now() - 5_000)

    expect(result.deletedFiles).toBe(1)
    expect(result.deletedDirs).toBe(0)
    expect(fs.existsSync(oldFile)).toBe(false)
    expect(fs.existsSync(newFile)).toBe(true)
  })
})
