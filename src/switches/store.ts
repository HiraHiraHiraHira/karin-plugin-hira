import fs from 'node:fs'
import path from 'node:path'

import { karinPathBase } from 'node-karin/root'

import { Root } from '@/root'
import { atomicWriteFileSync } from '@/runtime/atomicWrite'

import { leafModuleIds, moduleById, switchModules } from './modules'

export type GroupSwitchProfile = {
  /** 被关闭的模块 id。未列出的都视为开启，文件保持最小 */
  disabled: string[]
  /** 最后一次修改时间，方便排查 */
  updatedAt?: number
  /** 最后操作人 */
  updatedBy?: string
}

type SwitchFile = Record<string, GroupSwitchProfile>

const dataDir = () => path.join(karinPathBase, Root.pluginName, 'data')
const file = () => path.join(dataDir(), 'group-switches.json')

type CacheEntry = {
  mtimeMs: number
  size: number
  data: SwitchFile
}

let cache: CacheEntry | undefined

const emptyFile = (): SwitchFile => ({})

/** 读文件，按 mtime + size 缓存；手改文件后立刻生效，不用重启 */
const readFile = (): SwitchFile => {
  try {
    const target = file()
    const stat = fs.statSync(target)
    if (cache && cache.mtimeMs === stat.mtimeMs && cache.size === stat.size) return cache.data
    const parsed = JSON.parse(fs.readFileSync(target, 'utf8')) as SwitchFile
    const data = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : emptyFile()
    cache = { mtimeMs: stat.mtimeMs, size: stat.size, data }
    return data
  } catch {
    return emptyFile()
  }
}

/** 原子写：先写临时文件再 rename，兼容 Windows 覆盖冲突，避免进程被杀时留下半个 JSON */
const writeFile = (data: SwitchFile) => {
  atomicWriteFileSync(file(), `${JSON.stringify(data, null, 2)}\n`)
  cache = undefined
}

export const groupSwitchKey = (selfId: string, groupId: string) => `${selfId}:${groupId}`

export const getGroupProfile = (selfId: string, groupId: string): GroupSwitchProfile => {
  const entry = readFile()[groupSwitchKey(selfId, groupId)]
  const disabled = Array.isArray(entry?.disabled)
    ? entry.disabled.filter(id => typeof id === 'string')
    : []
  return {
    disabled,
    updatedAt: entry?.updatedAt,
    updatedBy: entry?.updatedBy
  }
}

/** 直接落在某个模块 id 上的关闭状态（不看上位模块） */
export const isModuleDirectlyDisabled = (selfId: string, groupId: string, moduleId: string) =>
  getGroupProfile(selfId, groupId).disabled.includes(moduleId)

/**
 * 模块是否生效：自己没被关，且链路上任何一个上位模块也没被关。
 * 例如关掉 `解析` 后，`resolve:bilibili` 即使没写进 disabled 也算关闭。
 */
export const isModuleEnabled = (selfId: string, groupId: string, moduleId: string) => {
  const disabled = getGroupProfile(selfId, groupId).disabled
  if (!disabled.length) return true

  let current: string | undefined = moduleId
  const seen = new Set<string>()
  while (current && !seen.has(current)) {
    if (disabled.includes(current)) return false
    seen.add(current)
    current = moduleById.get(current)?.parent
  }
  return true
}

export type SwitchChange = {
  moduleId: string
  enabled: boolean
}

/**
 * 批量改开关。返回值里带上真正发生变化的条目，命令层用它拼回执。
 * 关一个上位模块时，把下位模块里的同向记录清掉，避免「先关B站再关解析再开解析」留下历史残留。
 */
export const applySwitchChanges = (
  selfId: string,
  groupId: string,
  changes: SwitchChange[],
  operator?: string
) => {
  // 深拷贝后再修改，避免写盘失败时污染内存缓存造成内存与磁盘不一致
  const data = structuredClone(readFile())
  const key = groupSwitchKey(selfId, groupId)
  const current = new Set(data[key]?.disabled ?? [])
  const before = new Set(current)

  for (const change of changes) {
    if (change.enabled) {
      current.delete(change.moduleId)
      continue
    }
    current.add(change.moduleId)
    // 关上位模块时顺手清掉下位记录，重新开启时行为才符合直觉
    for (const child of switchModules) {
      if (child.parent === change.moduleId) current.delete(child.id)
    }
  }

  const changed = changes
    .filter(change => before.has(change.moduleId) === change.enabled)
    .map(change => ({ moduleId: change.moduleId, enabled: change.enabled }))

  if (!changed.length) return []

  data[key] = {
    disabled: [...current],
    updatedAt: Date.now(),
    updatedBy: operator
  }
  // 全部开启时删掉这条记录，文件保持干净
  if (!data[key].disabled.length) delete data[key]
  writeFile(data)
  return changed
}

export const setAllModules = (
  selfId: string,
  groupId: string,
  enabled: boolean,
  operator?: string
) => {
  const data = structuredClone(readFile())
  const key = groupSwitchKey(selfId, groupId)
  if (enabled) {
    if (!data[key]) return false
    delete data[key]
    writeFile(data)
    return true
  }

  const disabled = [...new Set([...leafModuleIds, ...switchModules
    .filter(module => module.parent)
    .map(module => module.id)])]
  data[key] = { disabled, updatedAt: Date.now(), updatedBy: operator }
  writeFile(data)
  return true
}

/** 状态列表用的快照：每个模块当前是否生效，以及是不是被上位模块连带关掉的 */
export type SwitchSnapshotItem = {
  id: string
  label: string
  enabled: boolean
  /** 上位模块连带关闭时为该上位模块的 label */
  mutedBy?: string
}

export const snapshotGroupSwitches = (selfId: string, groupId: string): SwitchSnapshotItem[] => {
  const direct = new Set(getGroupProfile(selfId, groupId).disabled)
  return switchModules.map((module) => {
    let mutedBy: string | undefined
    let current = module.parent
    const seen = new Set<string>()
    while (current && !seen.has(current)) {
      if (direct.has(current)) {
        mutedBy = moduleById.get(current)?.label ?? current
        break
      }
      seen.add(current)
      current = moduleById.get(current)?.parent
    }
    return {
      id: module.id,
      label: module.label,
      enabled: !direct.has(module.id) && !mutedBy,
      mutedBy
    }
  })
}
