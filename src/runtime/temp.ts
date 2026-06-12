import fs from 'node:fs'
import path from 'node:path'

import { karinPathBase } from 'node-karin/root'

import { Config } from '@/config'
import { Root } from '@/root'

export type CleanupResult = {
  deletedFiles: number
  deletedDirs: number
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

export const cleanupOldFiles = (root: string, beforeTimestamp: number): CleanupResult => {
  const resolvedRoot = path.resolve(root)
  const result: CleanupResult = { deletedFiles: 0, deletedDirs: 0 }
  if (!fs.existsSync(resolvedRoot)) return result

  const visit = (dir: string) => {
    if (!isSubPath(resolvedRoot, dir)) return
    for (const entry of fs.readdirSync(dir)) {
      const filePath = path.join(dir, entry)
      if (!isSubPath(resolvedRoot, filePath)) continue
      const stat = fs.statSync(filePath)
      if (stat.isDirectory()) {
        visit(filePath)
        if (filePath !== resolvedRoot && fs.existsSync(filePath) && fs.readdirSync(filePath).length === 0) {
          fs.rmdirSync(filePath)
          result.deletedDirs++
        }
        continue
      }

      if (stat.mtimeMs < beforeTimestamp) {
        fs.rmSync(filePath, { force: true })
        result.deletedFiles++
      }
    }
  }

  visit(resolvedRoot)
  return result
}

export const cleanupRuntimeTemp = () => {
  const cutoff = Date.now() - Config.runtime.cleanupMaxAgeMinutes * 60_000
  return cleanupOldFiles(getTempRoot(), cutoff)
}
