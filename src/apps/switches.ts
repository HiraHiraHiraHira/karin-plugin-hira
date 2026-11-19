import type { Message } from 'node-karin'

import { isHiraAppEnabled } from '@/apps/runtime'
import { replyPlainText, replyText } from '@/services/message'

import { parseSwitchCommand } from '@/switches/commandParser'
import { moduleById } from '@/switches/modules'
import {
  applySwitchChanges,
  setAllModules,
  snapshotGroupSwitches,
  type SwitchSnapshotItem
} from '@/switches/store'

type Resource = {
  selfId: string
  groupId: string
  /** 私聊远程操作时为 true */
  remote: boolean
}

const senderRole = (e: Message) => {
  const role = (e as Message & { sender?: { role?: string } }).sender?.role
  return role === 'owner' || role === 'admin' ? role : undefined
}

/** 群聊：群主/群管/机器人主人；私聊：只认主人 */
const canOperate = (e: Message) => Boolean(e.isMaster || e.isAdmin || senderRole(e))

const isGroupMessage = (e: Message) => Boolean((e as Message & { isGroup?: boolean }).isGroup)

const groupIdOf = (e: Message) => {
  const ctx = e as Message & { groupId?: string, contact?: { peer?: string } }
  return ctx.groupId ?? ctx.contact?.peer ?? ''
}

/**
 * 解析这条消息要操作哪个群。
 * 群聊里默认就是当前群；带了 `#群<号>` 时只有主人能指到别的群，避免群管改到不相关的群。
 */
const resolveResource = (e: Message, groupIdFromCommand?: string): Resource | { error: string } => {
  const inGroup = isGroupMessage(e)
  const currentGroupId = inGroup ? groupIdOf(e) : ''

  if (groupIdFromCommand) {
    if (inGroup && groupIdFromCommand !== currentGroupId && !e.isMaster) {
      return { error: '只有机器人主人能操作其它群。' }
    }
    if (!inGroup && !e.isMaster) return { error: '私聊只能由机器人主人操作。' }
    return { selfId: e.selfId, groupId: groupIdFromCommand, remote: !inGroup }
  }

  if (!inGroup) return { error: '私聊里请带上群号：#群123456789 点歌关闭' }
  if (!currentGroupId) return { error: '取不到当前群号，无法操作。' }
  return { selfId: e.selfId, groupId: currentGroupId, remote: false }
}

const stateText = (item: SwitchSnapshotItem) => {
  if (item.enabled) return '开启'
  if (item.mutedBy) return `随「${item.mutedBy}」关闭`
  return '关闭'
}

const statusLines = (items: SwitchSnapshotItem[]) => {
  const lines = ['本群功能开关']
  for (const item of items) {
    const indent = item.id.includes(':') ? '  ' : ''
    lines.push(`${indent}${item.label}：${stateText(item)}`)
  }
  return lines.join('\n')
}

/**
 * 回执必须把动词放在前面：「点歌已开启」以「点歌」开头，同群另一个 Bot 会把它当成
 * 点歌搜索命令再处理一次（实测会触发一次 10 秒的搜索请求）。「已开启点歌」不会被误认。
 */
export const toggleText = (label: string, enabled: boolean) => `${enabled ? '已开启' : '已关闭'}${label}`

export const switchHandler = async (e: Message, next?: () => unknown) => {
  if (!isHiraAppEnabled()) return next?.()

  const command = parseSwitchCommand(e.msg)
  if (command.type === 'none') return next?.()

  if (!canOperate(e)) {
    await replyText(e, '只有群主、管理员或机器人主人能改开关。')
    return true
  }

  const resource = resolveResource(e, command.groupId)
  if ('error' in resource) {
    await replyText(e, resource.error)
    return true
  }

  const { selfId, groupId } = resource
  const scope = resource.remote ? `群 ${groupId} ` : ''

  if (command.type === 'status') {
    if (command.moduleId) {
      const item = snapshotGroupSwitches(selfId, groupId)
        .find(entry => entry.id === command.moduleId)
      const label = moduleById.get(command.moduleId)?.label ?? command.moduleId
      // 单模块状态同样不能让模块名打头，否则会被另一个 Bot 当命令
      await replyPlainText(e, `${scope}开关状态｜${label}：${item ? stateText(item) : '未知'}`)
      return true
    }
    await replyPlainText(e, statusLines(snapshotGroupSwitches(selfId, groupId)))
    return true
  }

  if (command.type === 'all') {
    const changed = setAllModules(selfId, groupId, command.enabled, e.userId)
    const text = !changed
      ? `${scope}已经是全部开启状态了，没改`
      : `${scope}已${command.enabled ? '开启' : '关闭'}全部功能`
    await replyPlainText(e, text)
    return true
  }

  const label = moduleById.get(command.moduleId)?.label ?? command.moduleId
  const changed = applySwitchChanges(
    selfId,
    groupId,
    [{ moduleId: command.moduleId, enabled: command.enabled }],
    e.userId
  )
  const text = changed.length
    ? `${scope}${toggleText(label, command.enabled)}`
    : `${scope}本来就${command.enabled ? '开启' : '关闭'}了，没改`
  await replyPlainText(e, text)
  return true
}

