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
const isNpmNotFoundError = (error: unknown) => {
  const message = errorMessage(error)
  return message.includes('E404') || message.includes('404 Not Found') || message.includes('is not in this registry')
}

const hasGitDir = (dir: string) => fs.existsSync(path.join(dir, '.git'))

const readPackageDependencySpec = (cwd: string) => {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(cwd, 'package.json'), 'utf-8')) as {
      dependencies?: Record<string, string>
      devDependencies?: Record<string, string>
      optionalDependencies?: Record<string, string>
    }
    return pkg.dependencies?.[Root.pluginName] ||
      pkg.devDependencies?.[Root.pluginName] ||
      pkg.optionalDependencies?.[Root.pluginName]
  } catch {
    return undefined
  }
}

export const resolveGitUpdateTarget = (pluginPath = Root.pluginPath, cwd = process.cwd()) => {
  if (hasGitDir(pluginPath)) return { path: pluginPath, refreshInstall: false }

  const spec = readPackageDependencySpec(cwd)
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

  const update = await checkGitPluginUpdate(target.path)
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

const checkAvailableUpdate = async (): Promise<HiraUpdateResult> => {
  const update = await checkPkgUpdate(Root.pluginName, { compare: 'semver' })
  if (update.status === 'error' && isNpmNotFoundError(update.error)) return checkGitUpdate()
  return update
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

const shouldNotifyForLockedVersion = async (remoteVersion: string) => {
  try {
    const lockedVersion = await db.get(UPDATE_LOCK_KEY)
    if (typeof lockedVersion !== 'string' || lockedVersion.length === 0) return true

    if (!isSemverGreater(lockedVersion, Root.pluginVersion)) {
      await db.del(UPDATE_LOCK_KEY)
      return true
    }

    return isSemverGreater(remoteVersion, lockedVersion)
  } catch {
    return true
  }
}

const lockNotifiedVersion = async (remoteVersion: string) => {
  try {
    await db.set(UPDATE_LOCK_KEY, remoteVersion)
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

export const checkAndNotifyUpdate = async () => {
  const update = await checkAvailableUpdate().catch(() => undefined)
  if (!update || update.status !== 'yes') return true
  if (!('source' in update) && !isSemverGreater(update.remote, update.local)) return true
  if (!await shouldNotifyForLockedVersion(update.remote)) return true

  await lockNotifiedVersion(update.remote)

  const masters = karinConfig.master().filter(id => id !== 'console')
  if (masters.length === 0) return true

  const botItems = karin.getAllBotList()
    .filter(item => item.bot.account.name !== 'console')
  if (botItems.length === 0) return true

  const friendsMap = new Map<string, Array<{ userId: string }>>()
  await Promise.all(botItems.map(async (item) => {
    try {
      const friends = await item.bot.getFriendList()
      friendsMap.set(item.bot.account.selfId, Array.isArray(friends) ? friends : [])
    } catch {
      friendsMap.set(item.bot.account.selfId, [])
    }
  }))

  const masterToBot = new Map<string, typeof botItems[number]['bot']>()
  for (const master of masters) {
    const matched = botItems.find(item => (friendsMap.get(item.bot.account.selfId) || []).some(friend => friend.userId === master))
    if (matched) masterToBot.set(master, matched.bot)
  }

  const message = await updateReminderCardMessage(update)
  let storedMsgId: string | undefined

  for (const master of masters) {
    const bot = masterToBot.get(master)
    if (!bot) continue

    const result = await karin.sendMaster(bot.account.selfId, master, message)
    if (!storedMsgId && result?.messageId) storedMsgId = result.messageId
  }

  if (storedMsgId) {
    try {
      await db.set(UPDATE_MSGID_KEY, storedMsgId)
    } catch { }
  }

  return true
}

export const handleHiraUpdateReply = async (e: Message, next?: HookNext) => {
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
  if (!isHiraAppEnabled()) return next?.()
  await handleHiraUpdate(e)
  return true
}, {
  name: 'Hira-更新',
  perm: 'master'
})

export const update = karin.task('hira-更新检测', '*/3 * * * *', checkAndNotifyUpdate, {
  name: 'hira-更新检测',
  log: false
})
