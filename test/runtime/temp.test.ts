import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { karinPathTemp } from 'node-karin/root'
import { describe, expect, it } from 'vitest'

import { cleanupOldFiles, defaultTempRoot, ensureTempDir, getTempUsageBytes, isSubPath } from '@/runtime/temp'

describe('runtime temp helpers', () => {
  it('默认临时目录放在协议端可见的 Karin 共享 temp 下', () => {
    const root = defaultTempRoot()

    expect(isSubPath(karinPathTemp, root)).toBe(true)
    expect(path.basename(root)).toBe('karin-plugin-hira')
  })

  it('creates named temp directories under the configured root', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hira-temp-'))
    const dir = ensureTempDir(root, 'music')

    expect(fs.existsSync(dir)).toBe(true)
    expect(isSubPath(root, dir)).toBe(true)
    expect(path.basename(dir)).toBe('music')
  })

  it('reports the total size of files under the temp root', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hira-usage-'))
    fs.writeFileSync(path.join(root, 'a.tmp'), '123')
    fs.mkdirSync(path.join(root, 'nested'))
    fs.writeFileSync(path.join(root, 'nested', 'b.tmp'), '12345')

    expect(getTempUsageBytes(root)).toBe(8)
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
