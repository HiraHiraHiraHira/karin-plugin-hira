import type { Message } from 'node-karin'

import { Config } from '@/config'
import { isModuleEnabled } from '@/switches/store'

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const configuredCommandToPattern = (command: string) => {
  const normalized = command.trim().replace(/^#/, '')
  if (!normalized) return undefined
  return escapeRegExp(normalized).replace(/\\ /g, '\\s*')
}

export const createConfiguredCommandRegExp = (command: string, aliases: string[]) => {
  const patterns = [
    configuredCommandToPattern(command),
    ...aliases
  ].filter(Boolean)

  return new RegExp(`^#?(?:${patterns.join('|')})$`, 'i')
}

export const isHiraAppEnabled = () => Config.app.enabled

/**
 * 群级功能开关：私聊/频道没有群号，直接按开启处理；
 * 群聊按 `data/group-switches.json` 里该群的记录判断（含上位模块连带关闭）。
 */
export const isGroupModuleEnabled = (e: Message, moduleId: string) => {
  const ctx = e as Message & { isGroup?: boolean, groupId?: string, contact?: { peer?: string } }
  if (!ctx.isGroup) return true
  const groupId = ctx.groupId ?? ctx.contact?.peer ?? ''
  if (!groupId) return true
  return isModuleEnabled(e.selfId, groupId, moduleId)
}
