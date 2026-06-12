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

const merge = <T extends Record<string, unknown>>(base: T, override: Partial<T>): T => {
  const result: Record<string, unknown> = { ...base }
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
      result[key] = value
    }
  }
  return result as T
}

const readConfig = <T extends ConfigName>(name: T): HiraConfig[T] => {
  const fallback = defaultConfig[name]
  try {
    const file = path.join(userConfigDir, `${name}.yaml`)
    if (!fs.existsSync(file)) return fallback
    return merge(fallback as Record<string, unknown>, requireFileSync(file, { force: true }) as Record<string, unknown>) as HiraConfig[T]
  } catch (error) {
    logger.warn(`[karin-plugin-hira] 读取配置 ${name}.yaml 失败，使用默认配置: ${error}`)
    return fallback
  }
}

const writeConfig = <T extends ConfigName>(name: T, value: HiraConfig[T]) => {
  fs.mkdirSync(userConfigDir, { recursive: true })
  fs.writeFileSync(path.join(userConfigDir, `${name}.yaml`), YAML.stringify(value), 'utf8')
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
  fs.mkdirSync(userConfigDir, { recursive: true })
  const file = path.join(userConfigDir, 'music.yaml')
  const current = readConfig('music')
  const next = {
    ...current,
    cookies: {
      ...current.cookies,
      [source]: cookie
    }
  }
  fs.writeFileSync(file, YAML.stringify(next), 'utf8')
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
