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

const fallbackConfigDir = path.join(karinPathBase, Root.pluginName, 'config')
// 测试可以指向空目录，避免读到 Karin 运行目录里的真实插件配置。
const configRootDir = process.env.HIRA_CONFIG_ROOT?.trim() || fallbackConfigDir
const defaultConfigDir = path.join(Root.pluginPath, 'config', 'default_config')
const clone = <T>(value: T): T => {
  if (Array.isArray(value)) return value.map(item => clone(item)) as T
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, clone(item)])
    ) as T
  }
  return value
}

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

const legacyTranslateApi = 'https://api.interpreter.caiyunai.com/v1/translator'
const legacyLightApis = [
  'https://api.vvhan.com/api/tao',
  'https://api.vvhan.com/api/wallpaper/views'
]

/**
 * 升级迁移 (评审 R1): 旧版本 yaml 里的默认值会覆盖新 defaultConfig (merge 旧值优先),
 * 而这些地址已下线或协议已变更, 不迁移会让升级用户"开箱必失败".
 * 只替换"恰好等于旧默认值"的项, 用户自定义值保持不动; 不写盘, 下次 WebUI 保存自然落新值.
 */
const migrateLegacyDefaults = <T extends ConfigName>(name: T, config: HiraConfig[T]): HiraConfig[T] => {
  if (name === 'translate') {
    const translate = config as HiraConfig['translate']
    if (translate.tencentApi.trim() === legacyTranslateApi) {
      translate.tencentApi = defaultConfig.translate.tencentApi
    }
  }
  if (name === 'light') {
    const light = config as HiraConfig['light']
    if (light.buyerShowApis.length === 1 && light.buyerShowApis[0] === legacyLightApis[0]) {
      light.buyerShowApis = [...defaultConfig.light.buyerShowApis]
    }
    if (light.tiredApis.length === 1 && light.tiredApis[0] === legacyLightApis[1]) {
      light.tiredApis = [...defaultConfig.light.tiredApis]
    }
  }
  return config
}

const readConfig = <T extends ConfigName>(name: T): HiraConfig[T] => {
  const fallback = defaultConfig[name]
  try {
    const file = path.join(configRootDir, `${name}.yaml`)
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
      return migrateLegacyDefaults(name, merge(fallback as Record<string, unknown>, cached.parsed) as HiraConfig[T])
    }

    const parsed = requireFileSync(file, { force: true }) as Record<string, unknown>
    if (stat) configCache.set(name, { mtimeMs: stat.mtimeMs, size: stat.size, parsed })
    return migrateLegacyDefaults(name, merge(fallback as Record<string, unknown>, parsed) as HiraConfig[T])
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
  fs.mkdirSync(configRootDir, { recursive: true })
  const file = path.join(configRootDir, `${name}.yaml`)
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
    writeConfig(name, conformToDefaults(defaultConfig[name], config[name]))
  }
}

/** 以默认值为 schema 重建配置，丢掉旧版本遗留的键，避免已删除的配置项在保存时复活。 */
const conformToDefaults = <T>(schema: T, value: unknown): T => {
  if (Array.isArray(schema)) return (Array.isArray(value) ? value : schema) as T
  if (!schema || typeof schema !== 'object') {
    // 数字项允许以字符串落盘（YAML 加引号、人为手改），能无损转成数字就接受，其余类型不匹配仍回退默认值。
    if (typeof schema === 'number' && typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) {
      return Number(value) as T
    }
    return (value === undefined || typeof value !== typeof schema ? schema : value) as T
  }
  const source = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>
  const result: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(schema as Record<string, unknown>)) {
    result[key] = conformToDefaults(item, source[key])
  }
  return result as T
}

export const saveConfigModule = <T extends ConfigName>(name: T, value: HiraConfig[T]) => {
  writeConfig(name, conformToDefaults(defaultConfig[name], value))
}

export const initConfig = () => {
  try {
    copyConfigSync(defaultConfigDir, configRootDir)
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
