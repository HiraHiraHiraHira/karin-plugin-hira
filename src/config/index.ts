import fs from 'node:fs'
import path from 'node:path'

import { copyConfigSync, logger, requireFileSync } from 'node-karin'
import { karinPathBase } from 'node-karin/root'
import YAML from 'yaml'

import { Root } from '@/root'
import type { HiraConfig } from '@/types/config'
import type { MusicSource } from '@/music/types'

import { defaultConfig } from './defaults'

type ConfigName = keyof HiraConfig

const userConfigDir = path.join(karinPathBase, Root.pluginName, 'config')
const defaultConfigDir = path.join(Root.pluginPath, 'config', 'default_config')
const clone = <T>(value: T): T => structuredClone(value)

type ConfigCacheEntry = {
  mtimeMs: number
  size: number
  parsed: Record<string, unknown>
}

/** 按文件 mtimeMs + size 缓存已解析的 YAML，命中时跳过读盘和解析，改文件后立即失效 */
const configCache = new Map<ConfigName, ConfigCacheEntry>()

const merge = <T extends Record<string, unknown>>(base: T, override: Partial<T>): T => {
  const result: Record<string, unknown> = clone(base)
  for (const [key, value] of Object.entries(override || {})) {
    const baseValue = result[key]
    if (
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      baseValue &&
      typeof baseValue === 'object' &&
      !Array.isArray(baseValue)
    ) {
      result[key] = merge(baseValue as Record<string, unknown>, value as Record<string, unknown>)
    } else if (value !== undefined) {
      result[key] = clone(value)
    }
  }
  return result as T
}

const readConfig = <T extends ConfigName>(name: T): HiraConfig[T] => {
  const fallback = defaultConfig[name]
  try {
    const file = path.join(userConfigDir, `${name}.yaml`)
    if (!fs.existsSync(file)) {
      configCache.delete(name)
      return fallback
    }

    let stat: fs.Stats | undefined
    try {
      stat = fs.statSync(file)
    } catch {
      stat = undefined
    }

    const cached = stat ? configCache.get(name) : undefined
    if (stat && cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
      // 命中缓存：直接用缓存的解析结果 merge，merge 内部会 clone，保证每次返回全新对象
      return merge(fallback as Record<string, unknown>, cached.parsed) as HiraConfig[T]
    }

    const parsed = requireFileSync(file, { force: true }) as Record<string, unknown>
    if (stat) configCache.set(name, { mtimeMs: stat.mtimeMs, size: stat.size, parsed })
    return merge(fallback as Record<string, unknown>, parsed) as HiraConfig[T]
  } catch (error) {
    logger.warn(`[karin-plugin-hira] 读取配置 ${name}.yaml 失败，使用默认配置: ${error}`)
    return fallback
  }
}

const atomicWrite = (file: string, content: string) => {
  const temporaryFile = `${file}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`
  try {
    const descriptor = fs.openSync(temporaryFile, 'w')
    try {
      fs.writeFileSync(descriptor, content, 'utf8')
      fs.fsyncSync(descriptor)
    } finally {
      fs.closeSync(descriptor)
    }

    try {
      fs.renameSync(temporaryFile, file)
    } catch (error) {
      // Windows refuses to replace an existing file with renameSync. Remove only
      // the intended config file, then complete the same-directory replacement.
      if (error && typeof error === 'object' && 'code' in error && (error.code === 'EEXIST' || error.code === 'EPERM')) {
        fs.rmSync(file, { force: true })
        fs.renameSync(temporaryFile, file)
      } else {
        throw error
      }
    }
  } finally {
    fs.rmSync(temporaryFile, { force: true })
  }
}

const writeConfig = <T extends ConfigName>(name: T, value: HiraConfig[T]) => {
  fs.mkdirSync(userConfigDir, { recursive: true })
  const file = path.join(userConfigDir, `${name}.yaml`)
  const normalized = clone(value)
  atomicWrite(file, YAML.stringify(normalized))
}

export const readAllConfig = (): HiraConfig => ({
  app: readConfig('app'),
  music: readConfig('music'),
  resolver: readConfig('resolver'),
  runtime: readConfig('runtime'),
  light: readConfig('light'),
  translate: readConfig('translate'),
  ai: readConfig('ai')
})

export const saveAllConfig = (config: HiraConfig) => {
  for (const name of Object.keys(defaultConfig) as ConfigName[]) {
    writeConfig(name, config[name])
  }
}

export const saveConfigModule = <T extends ConfigName>(name: T, value: HiraConfig[T]) => {
  writeConfig(name, merge(defaultConfig[name] as Record<string, unknown>, value as Record<string, unknown>) as HiraConfig[T])
}

export const initConfig = () => {
  try {
    copyConfigSync(defaultConfigDir, userConfigDir)
  } catch (error) {
    logger.warn(`[karin-plugin-hira] 初始化配置失败: ${error}`)
  }
}

export const updateMusicCookie = (source: MusicSource, cookie: string) => {
  const current = readConfig('music')
  const next = {
    ...current,
    cookies: {
      ...current.cookies,
      [source]: cookie
    }
  }
  writeConfig('music', next)
}

export const Config: HiraConfig = {
  get app() {
    return readConfig('app')
  },
  get music() {
    return readConfig('music')
  },
  get resolver() {
    return readConfig('resolver')
  },
  get runtime() {
    return readConfig('runtime')
  },
  get light() {
    return readConfig('light')
  },
  get translate() {
    return readConfig('translate')
  },
  get ai() {
    return readConfig('ai')
  }
} as HiraConfig
