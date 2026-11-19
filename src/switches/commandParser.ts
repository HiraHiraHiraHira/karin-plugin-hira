import { allModuleIds, moduleByAlias, moduleById, offVerbs, onVerbs } from './modules'

export type SwitchCommand =
  | { type: 'status', groupId?: string, moduleId?: string }
  | { type: 'toggle', groupId?: string, moduleId: string, enabled: boolean }
  | { type: 'all', groupId?: string, enabled: boolean }
  | { type: 'none' }

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** 长词优先：`通用解析` 不能被 `通用` 截走，`关闭` 不能被 `关` 截走 */
const byLengthDesc = (left: string, right: string) => right.length - left.length

const aliasPattern = [...moduleByAlias.keys()].sort(byLengthDesc).map(escapeRegExp).join('|')
const offPattern = [...offVerbs].sort(byLengthDesc).map(escapeRegExp).join('|')
const onPattern = [...onVerbs].sort(byLengthDesc).map(escapeRegExp).join('|')

/**
 * 命令体（不含开头的 `#`）。
 * `#点歌开关` 这种「模块 + 开关」的写法也算状态查询，否则会被点歌当成搜索关键词。
 */
const switchBody = `(?:群\\s*\\d{5,}\\s*)?(?:`
  + `开关|`
  + `全部(?:${offPattern}|${onPattern})|`
  + `(?:${aliasPattern})(?:${offPattern}|${onPattern}|开关)`
  + `)`

/** 命令必须整条匹配，`#点歌 晴天` 这类正常点歌不会误伤 */
export const switchCommandReg = new RegExp(`^#${switchBody}$`, 'i')

/**
 * 给同样以 `#点歌` 开头的命令用的负向断言：Karin 1.18 的命令按加载顺序匹配，
 * 点歌文件排在开关前面，`#点歌关闭` 会先被点歌当成搜索「关闭」。
 * 把这段拼在点歌正则最前面，相当于让关闭类命令永远优先匹配。
 */
export const notSwitchCommandSource = `(?!#${switchBody}$)`

export const isSwitchCommand = (message: string) => switchCommandReg.test(message)

/** `#群477640404 点歌关闭`：私聊里远程操作别的群 */
const groupPrefixReg = /^#\s*群\s*(\d{5,})\s*/

const stripPrefix = (message: string) => {
  const trimmed = message.trim()
  const groupMatch = trimmed.match(groupPrefixReg)
  if (!groupMatch) return { rest: trimmed.replace(/^#/, '').trim(), groupId: undefined as string | undefined }
  return { rest: trimmed.slice(groupMatch[0].length).trim(), groupId: groupMatch[1] }
}

/** 从尾部切开关动词，返回剩余命令词与目标状态 */
const splitVerb = (body: string): { word: string, enabled: boolean } | undefined => {
  for (const verb of [...onVerbs].sort(byLengthDesc)) {
    if (body.length > verb.length && body.endsWith(verb)) {
      return { word: body.slice(0, -verb.length), enabled: true }
    }
  }
  for (const verb of [...offVerbs].sort(byLengthDesc)) {
    if (body.length > verb.length && body.endsWith(verb)) {
      return { word: body.slice(0, -verb.length), enabled: false }
    }
  }
  return undefined
}

const resolveModuleId = (word: string) => {
  const key = word.toLowerCase()
  const direct = moduleByAlias.get(key)
  if (direct) return direct
  // `#点歌功能关闭` 这类带了「功能」后缀的写法
  const trimmed = key.replace(/功能$/, '')
  return moduleByAlias.get(trimmed)
}

export const parseSwitchCommand = (message: string): SwitchCommand => {
  if (!switchCommandReg.test(message)) return { type: 'none' }

  const { rest, groupId } = stripPrefix(message)
  if (!rest) return { type: 'none' }

  if (/^(?:开关|状态)$/i.test(rest)) return { type: 'status', groupId }

  // 单个模块的状态查询必须在切动词之前判断：`点歌开关` 会被 `关` 误切成 `点歌开`
  if (/开关$/i.test(rest)) {
    const moduleId = resolveModuleId(rest.slice(0, -2))
    return { type: 'status', groupId, moduleId }
  }

  const split = splitVerb(rest)
  if (!split) return { type: 'none' }

  if (split.word === '全部' || split.word === '所有') {
    return { type: 'all', groupId, enabled: split.enabled }
  }

  const moduleId = resolveModuleId(split.word)
  if (!moduleId) return { type: 'none' }
  return { type: 'toggle', groupId, moduleId, enabled: split.enabled }
}

/** 状态列表里显示模块名，命令回执直接用 */
export const moduleLabel = (moduleId: string) => moduleById.get(moduleId)?.label ?? moduleId

export const moduleIdList = allModuleIds
