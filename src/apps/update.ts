import fs from 'node:fs'
import path from 'node:path'

import karin, {
  checkGitPluginUpdate,
  checkPkgUpdate,
  config as karinConfig,
  db,
  exec,
  getLocalCommitHash,
  getRemoteCommitHash,
  hooks,
  restart,
  segment,
  updateGitPlugin,
  updatePkg
} from 'node-karin'
import type { Message } from 'node-karin'

import { Config } from '@/config'
import { createConfiguredCommandRegExp, isHiraAppEnabled } from '@/apps/runtime'
import { isNpmRegistrySpec, readPackageDependencySpec } from '@/apps/installSource'
import { Root } from '@/root'
import { isSemverGreater } from '@/runtime/semver'
import {
  buildUpdateCardHtml,
  logCardRenderFailure,
  renderCardImage,
  type UpdateCardOptions
} from '@/services/cardRender'

export const UPDATE_LOCK_KEY = 'hira:update:lock'
export const UPDATE_MSGID_KEY = 'hira:update:msgId'
export const UPDATE_LAST_CHECK_KEY = 'hira:update:lastCheckAt'

export const updateReg = createConfiguredCommandRegExp('#Hira更新', ['hira\\s*更新', 'hi\\s*更新'])

type ReplyPayload = Parameters<Message['reply']>[0]
type ReplyOptions = Parameters<Message['reply']>[1]
type HookNext = () => unknown | Promise<unknown>
type NpmUpdateResult = Awaited<ReturnType<typeof checkPkgUpdate>>
type GitUpdateResult = {
  status: 'yes'
  local: string
  remote: string
  count: number
  data: string
  path: string
  refreshInstall: boolean
  source: 'git'
} | {
  status: 'no'
  local: string
  path: string
  refreshInstall: boolean
  source: 'git'
} | {
  status: 'error'
  error: Error
  source: 'git'
}
type HiraUpdateResult = NpmUpdateResult | GitUpdateResult

const errorMessage = (error: unknown) => error instanceof Error ? error.message : String(error)

const hasGitDir = (dir: string) => fs.existsSync(path.join(dir, '.git'))

export const resolveGitUpdateTarget = (pluginPath = Root.pluginPath, cwd = process.cwd()) => {
  if (hasGitDir(pluginPath)) return { path: pluginPath, refreshInstall: false }

  const spec = readPackageDependencySpec(Root.pluginName, cwd)
  if (spec?.startsWith('file:')) {
    const sourcePath = path.resolve(cwd, spec.slice('file:'.length))
    if (hasGitDir(sourcePath)) return { path: sourcePath, refreshInstall: true }
  }

  const siblingPath = path.resolve(cwd, '..', Root.pluginName)
  if (hasGitDir(siblingPath)) return { path: siblingPath, refreshInstall: true }

  return undefined
}

const refreshFileInstall = async () => {
  const cwd = process.cwd()
  const command = fs.existsSync(path.join(cwd, 'pnpm-lock.yaml'))
    ? 'pnpm install --force'
    : 'npm install'
  const result = await exec(command, { cwd })
  if (typeof result === 'boolean') return result
  return result.status
}

const replyUpdateText = async (e: Message, text: string, options?: ReplyOptions) => {
  const payload = `${Config.app.replyPrefix}：${text}` as ReplyPayload
  if (options) return e.reply(payload, options)
  return e.reply(payload)
}

const updateSourceText = (update: HiraUpdateResult | Extract<NpmUpdateResult, { status: 'yes' | 'no' }>) => (
  'source' in update && update.source === 'git' ? 'Git' : 'npm'
)

const displayVersion = (version: string) => version.trim().match(/^v/i) ? version.trim() : `v${version.trim()}`

const currentPluginVersionText = () => displayVersion(Root.pluginVersion)

const gitCommitMeta = (local: string, remote?: string) => [
  { label: '当前提交', value: local },
  ...(remote ? [{ label: '远程提交', value: remote }] : [])
]

const gitVersionFallbackText = (title: string, local: string, remote?: string, extraLines: string[] = []) => [
  title,
  `当前版本：${currentPluginVersionText()}`,
  `当前提交：${local}`,
  ...(remote ? [`远程提交：${remote}`] : []),
  ...extraLines
].join('\n')

const stripAnsi = (value: string) => value.replace(/\u001b\[[0-9;]*m/g, '')

const updateDetailLines = (value?: string) => (
  stripAnsi(value || '')
    .split(/\r?\n/)
    .map(line => line.replace(/^\s*[-*]\s*/, '').trim())
    .filter(Boolean)
    .slice(0, 6)
)

const replyUpdateCard = async (
  e: Message,
  options: UpdateCardOptions,
  fallbackText: string,
  replyOptions?: ReplyOptions
) => {
  try {
    const images = await renderCardImage({
      name: 'update',
      html: buildUpdateCardHtml(options),
      width: 920
    })
    const payload = images as ReplyPayload
    if (replyOptions) return e.reply(payload, replyOptions)
    return e.reply(payload)
  } catch (error) {
    logCardRenderFailure('update', error)
    return replyUpdateText(e, fallbackText, replyOptions)
  }
}

const clearUpdateNoticeState = async () => {
  try {
    await db.del(UPDATE_MSGID_KEY)
    await db.del(UPDATE_LOCK_KEY)
  } catch { }
}

const checkGitUpdate = async (): Promise<GitUpdateResult> => {
  const target = resolveGitUpdateTarget()
  if (!target) {
    return {
      status: 'error',
      error: new Error(`${Root.pluginName} 未发布到 npm，且当前安装目录不是 Git 仓库。请使用 Git 克隆安装，或在宿主项目 package.json 中使用 file: 指向源码仓库。`),
      source: 'git'
    }
  }

  const update = await checkGitPluginUpdate(target.path).catch((error: unknown) => ({
    status: 'error' as const,
    data: error instanceof Error ? error : new Error(String(error))
  }))
  // node-karin 的契约是必定返回对象，但它内部有分支只 clearTimeout 不返回，
  // 这里兜住 undefined，避免退化成 "Cannot read properties of undefined"。
  if (!update || typeof update !== 'object') {
    return {
      status: 'error',
      error: new Error(`${Root.pluginName} 的 Git 更新检查没有返回结果，请手动在 ${target.path} 执行 git fetch 排查。`),
      source: 'git'
    }
  }
  if (update.status === 'error') {
    return {
      status: 'error',
      error: update.data instanceof Error ? update.data : new Error(String(update.data)),
      source: 'git'
    }
  }

  const local = await getLocalCommitHash(target.path, { short: true }).catch(() => Root.pluginVersion)
  if (update.status === 'no') return { status: 'no', local, path: target.path, refreshInstall: target.refreshInstall, source: 'git' }

  const remote = await getRemoteCommitHash(target.path, { short: true }).catch(() => `origin +${update.count}`)
  return {
    status: 'yes',
    local,
    remote,
    count: update.count,
    data: update.data,
    path: target.path,
    refreshInstall: target.refreshInstall,
    source: 'git'
  }
}

export const resolveUpdateCheckSource = (pluginPath = Root.pluginPath, cwd = process.cwd()) => {
  if (isNpmRegistrySpec(readPackageDependencySpec(Root.pluginName, cwd))) return 'npm' as const
  return resolveGitUpdateTarget(pluginPath, cwd) ? 'git' as const : 'none' as const
}

const checkAvailableUpdate = async (): Promise<HiraUpdateResult> => {
  const source = resolveUpdateCheckSource()
  if (source === 'npm') return checkPkgUpdate(Root.pluginName, { compare: 'semver' })
  if (source === 'git') return checkGitUpdate()

  // 既非 npm 声明安装、目录又不是 Git 仓库（例如宿主用 pnpm/tarball 安装）：
  // 调 checkPkgUpdate 只会让 Karin 打一条 npm 404 日志，直接返回可读错误。
  return {
    status: 'error',
    error: new Error(`${Root.pluginName} 未声明为 npm 依赖，安装目录也不是 Git 仓库，无法检查更新。请使用 Git 克隆安装，或在宿主项目 package.json 中使用 file: 指向源码仓库。`),
    source: 'git'
  }
}

const updateByGit = async (update: Extract<GitUpdateResult, { status: 'yes' }>, e: Message) => {
  await replyUpdateCard(
    e,
    {
      state: 'available',
      title: '发现 Git 更新',
      subtitle: `检测到 ${update.count} 次新提交，更新前先展示摘要。`,
      current: currentPluginVersionText(),
      latest: currentPluginVersionText(),
      source: 'Git',
      lagCount: update.count,
      meta: gitCommitMeta(update.local, update.remote),
      details: updateDetailLines(update.data),
      tip: `将开始更新 ${Root.pluginName}，成功后自动重启 Karin。`
    },
    gitVersionFallbackText('检测到 Git 更新', update.local, update.remote, [
      `落后 ${update.count} 次提交，开始更新 ${Root.pluginName} ...`
    ]),
    { reply: true }
  )
  const result = await updateGitPlugin(update.path)
  if (result.status !== 'ok') {
    await replyUpdateText(e, `${Root.pluginName} Git 更新失败: ${result.data instanceof Error ? result.data.message : result.data}`)
    return
  }

  if (update.refreshInstall && !await refreshFileInstall()) {
    await replyUpdateText(e, `${Root.pluginName} Git 更新成功，但刷新 file 依赖失败。请在 Karin 目录执行 pnpm install --force 后重启。`)
    return
  }

  const msgResult = await replyUpdateText(
    e,
    `${Root.pluginName} Git 更新成功！\n${result.commit || result.data}\n开始执行重启......`
  )
  if (msgResult.messageId) {
    await clearUpdateNoticeState()
  }
  await restart(e.selfId, e.contact, msgResult.messageId)
}

export const handleHiraUpdate = async (e: Message) => {
  try {
    const update = await checkAvailableUpdate()
    if (update.status === 'error') {
      await replyUpdateText(e, `获取远程版本失败：${errorMessage(update.error)}`)
      return
    }

    if (update.status === 'no') {
      const source = updateSourceText(update)
      await replyUpdateCard(
        e,
        {
          state: 'latest',
          title: '当前已是最新版本',
          subtitle: `${source} 检查完成，没有发现新的可用更新。`,
          current: source === 'Git' ? currentPluginVersionText() : displayVersion(update.local),
          latest: source === 'Git' ? currentPluginVersionText() : displayVersion(update.local),
          source,
          lagCount: 0,
          meta: source === 'Git' ? gitCommitMeta(update.local) : undefined,
          tip: source === 'Git'
            ? 'Hira 当前 Git 提交已与远程保持一致。'
            : 'Hira 当前 npm 版本已是可用最新版本。'
        },
        source === 'Git'
          ? gitVersionFallbackText('当前已是最新版本', update.local)
          : `当前已是最新版本：${update.local}`,
        { reply: true }
      )
      return
    }

    if ('source' in update && update.source === 'git') {
      await updateByGit(update, e)
      return
    }

    if (!isSemverGreater(update.remote, update.local)) {
      await replyUpdateCard(
        e,
        {
          state: 'preview',
          title: '当前已是最新或预览版本',
          subtitle: '远程稳定版本没有高于当前版本，暂不执行更新。',
          current: displayVersion(update.local),
          latest: displayVersion(update.remote),
          source: 'npm',
          tip: '如果这是预览版或本地开发版，保持当前版本即可。'
        },
        `当前已是最新或预览版本：${update.local}`,
        { reply: true }
      )
      return
    }

    await replyUpdateCard(
      e,
      {
        state: 'available',
        title: '发现可用更新',
        subtitle: '检测到 npm 远程版本更新，更新前先展示摘要。',
        current: displayVersion(update.local),
        latest: displayVersion(update.remote),
        source: 'npm',
        tip: `将开始更新 ${Root.pluginName}，成功后自动重启 Karin。`
      },
      `检测到可用更新：${update.local} -> ${update.remote}\n开始更新 ${Root.pluginName} ...`,
      { reply: true }
    )
    const result = await updatePkg(Root.pluginName)
    if (result.status !== 'ok') {
      await replyUpdateText(e, `${Root.pluginName} 更新失败: ${result.data ?? '更新执行失败'}`)
      return
    }

    const msgResult = await replyUpdateText(
      e,
      `${Root.pluginName} 更新成功！\n${result.local} -> ${result.remote}\n开始执行重启......`
    )
    if (msgResult.messageId) {
      await clearUpdateNoticeState()
    }
    await restart(e.selfId, e.contact, msgResult.messageId)
  } catch (error) {
    await replyUpdateText(e, `${Root.pluginName} 更新失败: ${errorMessage(error)}`)
  }
}

const isGitUpdate = (update: HiraUpdateResult): update is Extract<GitUpdateResult, { status: 'yes' | 'no' }> => (
  'source' in update && update.source === 'git'
)

const shouldNotifyForLockedVersion = async (update: Extract<HiraUpdateResult, { status: 'yes' }>) => {
  try {
    const lockedVersion = await db.get(UPDATE_LOCK_KEY)
    if (typeof lockedVersion !== 'string' || lockedVersion.length === 0) return true

    // Git 模式以远程短 commit hash 去重：同一 commit 已推过则不再重复刷屏，出现新 commit 再推。
    if (isGitUpdate(update)) {
      return lockedVersion !== update.remote
    }

    if (!isSemverGreater(lockedVersion, Root.pluginVersion)) {
      await db.del(UPDATE_LOCK_KEY)
      return true
    }

    return isSemverGreater(update.remote, lockedVersion)
  } catch {
    return true
  }
}

const lockNotifiedVersion = async (remoteVersion: string) => {
  try {
    await db.set(UPDATE_LOCK_KEY, remoteVersion)
  } catch { }
}

const parseNotifyGroupIds = (raw: string | undefined) => (
  Array.from(new Set(
    String(raw || '')
      .split(/[\s,，;；]+/)
      .map(id => id.trim())
      .filter(Boolean)
  ))
)

const isScheduledCheckDue = async (intervalHours: number) => {
  const intervalMs = Math.max(1, intervalHours) * 3600_000
  try {
    const raw = await db.get(UPDATE_LAST_CHECK_KEY)
    const last = typeof raw === 'number' ? raw : Number(raw)
    if (Number.isFinite(last) && last > 0 && Date.now() - last < intervalMs) {
      return false
    }
  } catch { }
  return true
}

const recordLastCheckAt = async () => {
  try {
    await db.set(UPDATE_LAST_CHECK_KEY, String(Date.now()))
  } catch { }
}

const updateReminderText = (localVersion: string, remoteVersion: string) => [
  `${Root.pluginName} 有新的更新！`,
  `当前版本：${localVersion}`,
  `最新版本：${remoteVersion}`,
  '',
  '回复这条消息“更新”可自动更新并重启。',
  '也可以发送 #Hira更新 手动检查。'
].join('\n')

const gitUpdateReminderText = (update: Extract<GitUpdateResult, { status: 'yes' }>) => [
  `${Root.pluginName} 有新的更新！`,
  `当前版本：${currentPluginVersionText()}`,
  `当前提交：${update.local}`,
  `远程提交：${update.remote}`,
  `落后提交：${update.count} 次`,
  '',
  '回复这条消息“更新”可自动更新并重启。',
  '也可以发送 #Hira更新 手动检查。'
].join('\n')

const updateReminderCardMessage = async (update: Extract<HiraUpdateResult, { status: 'yes' }>) => {
  const source = updateSourceText(update)
  try {
    const images = await renderCardImage({
      name: 'update',
      html: buildUpdateCardHtml({
        state: 'available',
        title: source === 'Git' ? '发现 Git 更新' : '发现可用更新',
        subtitle: '回复这条消息“更新”可自动更新并重启。',
        current: source === 'Git' ? currentPluginVersionText() : displayVersion(update.local),
        latest: source === 'Git' ? currentPluginVersionText() : displayVersion(update.remote),
        source,
        lagCount: 'source' in update && update.source === 'git' ? update.count : undefined,
        meta: 'source' in update && update.source === 'git' ? gitCommitMeta(update.local, update.remote) : undefined,
        details: 'source' in update && update.source === 'git' ? updateDetailLines(update.data) : undefined,
        tip: '也可以发送 #Hira更新 手动检查。'
      }),
      width: 920
    })
    return [
      segment.text(`${Root.pluginName} 有新的更新！`),
      ...images
    ]
  } catch (error) {
    logCardRenderFailure('update-reminder', error)
    if ('source' in update && update.source === 'git') return [segment.text(gitUpdateReminderText(update))]
    return [segment.text(updateReminderText(update.local, update.remote))]
  }
}

export const checkAndNotifyUpdate = async (options?: { scheduled?: boolean }) => {
  if (!isHiraAppEnabled()) return true
  const notifyConfig = Config.app.updateNotify
  if (notifyConfig?.enabled === false) return true

  // 无法确定更新来源（非 npm 声明安装且非 Git 目录）时不轮询、不报错，避免刷日志。
  if (resolveUpdateCheckSource() === 'none') return true

  if (options?.scheduled) {
    const due = await isScheduledCheckDue(notifyConfig?.intervalHours ?? 6)
    if (!due) return true
    await recordLastCheckAt()
  }

  const update = await checkAvailableUpdate().catch(() => undefined)
  if (!update || update.status !== 'yes') return true
  if (!isGitUpdate(update) && !isSemverGreater(update.remote, update.local)) return true
  if (!await shouldNotifyForLockedVersion(update)) return true

  const notifyMasters = notifyConfig?.notifyMasters !== false
  const masters = notifyMasters ? karinConfig.master().filter(id => id !== 'console') : []
  const groupIds = parseNotifyGroupIds(notifyConfig?.groupIds)
  if (masters.length === 0 && groupIds.length === 0) return true

  const botItems = karin.getAllBotList()
    .filter(item => item.bot.account.name !== 'console')
  if (botItems.length === 0) return true

  const friendsMap = new Map<string, Array<{ userId: string }>>()
  const groupsMap = new Map<string, Array<{ groupId: string }>>()

  await Promise.all(botItems.map(async (item) => {
    const selfId = item.bot.account.selfId
    if (masters.length > 0) {
      try {
        const friends = await item.bot.getFriendList()
        friendsMap.set(selfId, Array.isArray(friends) ? friends : [])
      } catch {
        friendsMap.set(selfId, [])
      }
    }
    if (groupIds.length > 0 && typeof item.bot.getGroupList === 'function') {
      try {
        const groups = await item.bot.getGroupList()
        groupsMap.set(selfId, Array.isArray(groups) ? groups : [])
      } catch {
        groupsMap.set(selfId, [])
      }
    }
  }))

  const masterToBot = new Map<string, typeof botItems[number]['bot']>()
  for (const master of masters) {
    const matched = botItems.find(item => (friendsMap.get(item.bot.account.selfId) || []).some(friend => friend.userId === master))
    if (matched) masterToBot.set(master, matched.bot)
  }

  const groupToBot = new Map<string, typeof botItems[number]['bot']>()
  for (const groupId of groupIds) {
    const matched = botItems.find(item => (groupsMap.get(item.bot.account.selfId) || []).some(group => String(group.groupId) === groupId))
    if (matched) groupToBot.set(groupId, matched.bot)
  }

  if (masterToBot.size === 0 && groupToBot.size === 0) return true

  const message = await updateReminderCardMessage(update)
  let storedMsgId: string | undefined
  let sentCount = 0

  for (const master of masters) {
    const bot = masterToBot.get(master)
    if (!bot) continue

    try {
      const result = await karin.sendMaster(bot.account.selfId, master, message)
      sentCount += 1
      if (!storedMsgId && result?.messageId) storedMsgId = result.messageId
    } catch { }
  }

  for (const groupId of groupIds) {
    const bot = groupToBot.get(groupId)
    if (!bot) continue

    try {
      await karin.sendMsg(bot.account.selfId, karin.contactGroup(groupId), message)
      sentCount += 1
    } catch { }
  }

  // 至少成功送达一条后才落锁，避免 Bot 刚启动尚未连上时被静默吞掉通知。
  if (sentCount > 0) {
    await lockNotifiedVersion(update.remote)
  }

  if (storedMsgId) {
    try {
      await db.set(UPDATE_MSGID_KEY, storedMsgId)
    } catch { }
  }

  return true
}

export const handleHiraUpdateReply = async (e: Message, next?: HookNext) => {
  if (!isHiraAppEnabled() || !e.isMaster) {
    await next?.()
    return
  }
  if (e.msg.includes('更新')) {
    const msgId = await db.get(UPDATE_MSGID_KEY)
    if (typeof msgId === 'string' && e.replyId === msgId) {
      await handleHiraUpdate(e)
    }
  }
  await next?.()
}

export const hiraUpdateHook = hooks.message.friend(handleHiraUpdateReply, { priority: 100 })

export const hiraUpdateCommand = karin.command(updateReg, async (e, next) => {
  if (!isHiraAppEnabled() || !e.isMaster) return next?.()
  await handleHiraUpdate(e)
  return true
}, {
  name: 'Hira-更新'
})

export const update = karin.task('hira-更新检测', '0 * * * *', () => checkAndNotifyUpdate({ scheduled: true }), {
  name: 'hira-更新检测',
  log: false
})
