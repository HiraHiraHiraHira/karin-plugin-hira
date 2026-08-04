import fs from 'node:fs'
import path from 'node:path'

import { karinPathBase } from 'node-karin/root'

import { Config } from '@/config'
import { Root } from '@/root'

export type CleanupResult = {
  deletedFiles: number
  deletedDirs: number
}

type TempFileEntry = {
  path: string
  size: number
  mtimeMs: number
}

export const defaultTempRoot = () => path.join(karinPathBase, Root.pluginName, 'data', 'temp')

export const getTempRoot = () => Config.runtime.tempRoot.trim() || defaultTempRoot()

export const isSubPath = (root: string, target: string) => {
  const relative = path.relative(path.resolve(root), path.resolve(target))
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

export const ensureTempDir = (root: string, name: string) => {
  const safeName = name.replace(/[^\w.-]+/g, '_')
  const dir = path.resolve(root, safeName)
  if (!isSubPath(root, dir)) throw new Error('临时目录越界')
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

export const createTempFilePath = (scope: string, ext: string) => {
  const dir = ensureTempDir(getTempRoot(), scope)
  const cleanExt = ext.replace(/^\.+/, '').replace(/[^\w]+/g, '') || 'tmp'
  return path.join(dir, `${Date.now()}-${Math.random().toString(36).slice(2)}.${cleanExt}`)
}

const visitFiles = (root: string, callback: (filePath: string, stat: fs.Stats) => void) => {
  const resolvedRoot = path.resolve(root)
  if (!fs.existsSync(resolvedRoot)) return

  const visit = (dir: string) => {
    if (!isSubPath(resolvedRoot, dir)) return
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const filePath = path.join(dir, entry.name)
      if (!isSubPath(resolvedRoot, filePath)) continue
      try {
        const stat = fs.lstatSync(filePath)
        if (stat.isDirectory()) visit(filePath)
        else callback(filePath, stat)
      } catch {
        // A concurrent downloader may have removed the entry already.
      }
    }
  }

  visit(resolvedRoot)
}

const removeEmptyDirs = (root: string, result: CleanupResult) => {
  const resolvedRoot = path.resolve(root)
  const visit = (dir: string) => {
    if (!isSubPath(resolvedRoot, dir) || !fs.existsSync(dir)) return
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (entry.isDirectory()) visit(path.join(dir, entry.name))
    }
    if (dir !== resolvedRoot) {
      try {
        if (fs.readdirSync(dir).length === 0) {
          fs.rmdirSync(dir)
          result.deletedDirs++
        }
      } catch {
        // Ignore a directory that became non-empty or disappeared concurrently.
      }
    }
  }
  visit(resolvedRoot)
}

export const cleanupOldFiles = (root: string, beforeTimestamp: number): CleanupResult => {
  const result: CleanupResult = { deletedFiles: 0, deletedDirs: 0 }
  visitFiles(root, (filePath, stat) => {
    if (stat.mtimeMs >= beforeTimestamp) return
    try {
      fs.rmSync(filePath, { force: true })
      result.deletedFiles++
    } catch {
      // Keep the cleanup loop alive when a file is locked by another process.
    }
  })
  removeEmptyDirs(root, result)
  return result
}

export const getTempUsageBytes = (root: string) => {
  let total = 0
  visitFiles(root, (_filePath, stat) => {
    total += stat.size
  })
  return total
}

const enforceTempQuota = (root: string, maxBytes: number, result: CleanupResult) => {
  if (!Number.isFinite(maxBytes) || maxBytes <= 0) return
  const entries: TempFileEntry[] = []
  visitFiles(root, (filePath, stat) => {
    entries.push({ path: filePath, size: stat.size, mtimeMs: stat.mtimeMs })
  })

  let usage = entries.reduce((total, entry) => total + entry.size, 0)
  if (usage <= maxBytes) return
  const now = Date.now()
  for (const entry of entries.sort((left, right) => left.mtimeMs - right.mtimeMs)) {
    // Avoid evicting a freshly written download part while it is likely active.
    if (entry.path.includes('.part-') && now - entry.mtimeMs < 5 * 60_000) continue
    try {
      fs.rmSync(entry.path, { force: true })
      usage -= entry.size
      result.deletedFiles++
      if (usage <= maxBytes) break
    } catch {
      // Keep trying newer files when an old file is locked.
    }
  }
  removeEmptyDirs(root, result)
}

export const cleanupRuntimeTemp = () => {
  const result = Config.runtime.cleanupEnabled
    ? cleanupOldFiles(getTempRoot(), Date.now() - Config.runtime.cleanupMaxAgeMinutes * 60_000)
    : { deletedFiles: 0, deletedDirs: 0 }
  enforceTempQuota(getTempRoot(), Config.runtime.maxTempBytes, result)
  return result
}
