import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import type { Message } from 'node-karin'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const karinMocks = vi.hoisted(() => {
  const command = vi.fn((_reg, handler, options) => ({ handler, options }))
  const task = vi.fn((_title, _cron, handler, options) => ({ handler, options }))
  const friendHook = vi.fn((handler, options) => ({ handler, options }))

  return {
    checkPkgUpdate: vi.fn(),
    checkGitPluginUpdate: vi.fn(),
    getLocalCommitHash: vi.fn(),
    getRemoteCommitHash: vi.fn(),
    updatePkg: vi.fn(),
    updateGitPlugin: vi.fn(),
    exec: vi.fn(),
    restart: vi.fn(),
    dbGet: vi.fn(),
    dbSet: vi.fn(),
    dbDel: vi.fn(),
    master: vi.fn(),
    getAllBotList: vi.fn(),
    sendMaster: vi.fn(),
    render: vi.fn(async () => Buffer.from('update-card').toString('base64')),
    command,
    task,
    friendHook
  }
})

vi.mock('node-karin', async importOriginal => {
  const actual = await importOriginal<typeof import('node-karin')>()
  const mockedKarin = {
    ...actual.default,
    command: karinMocks.command,
    task: karinMocks.task,
    getAllBotList: karinMocks.getAllBotList,
    sendMaster: karinMocks.sendMaster
  }

  return {
    ...actual,
    default: mockedKarin,
    karin: mockedKarin,
    checkPkgUpdate: karinMocks.checkPkgUpdate,
    checkGitPluginUpdate: karinMocks.checkGitPluginUpdate,
    getLocalCommitHash: karinMocks.getLocalCommitHash,
    getRemoteCommitHash: karinMocks.getRemoteCommitHash,
    updatePkg: karinMocks.updatePkg,
    updateGitPlugin: karinMocks.updateGitPlugin,
    exec: karinMocks.exec,
    restart: karinMocks.restart,
    config: {
      ...actual.config,
      master: karinMocks.master
    },
    render: {
      ...actual.render,
      render: karinMocks.render
    },
    db: {
      ...actual.db,
      get: karinMocks.dbGet,
      set: karinMocks.dbSet,
      del: karinMocks.dbDel
    },
    hooks: {
      ...actual.hooks,
      message: {
        ...actual.hooks.message,
        friend: karinMocks.friendHook
      }
    }
  }
})

const importUpdate = async () => {
  vi.resetModules()
  return import('@/apps/update')
}

const createMessage = () => {
  const reply = vi.fn(async () => ({ messageId: 'reply-1' }))
  return {
    reply,
    selfId: 'bot-1',
    msg: '#Hira更新',
    contact: { scene: 'friend', peer: 'owner-1' },
    replyId: ''
  } as unknown as Message & { reply: typeof reply, msg: string, replyId: string }
}

const readFirstRenderedHtml = () => {
  const firstCall = karinMocks.render.mock.calls[0] as unknown as [{ file?: unknown }] | undefined
  const file = firstCall?.[0]?.file
  expect(file).toEqual(expect.any(String))
  return fs.readFileSync(String(file), 'utf-8')
}

describe('update command', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    karinMocks.master.mockReturnValue(['owner-1'])
    karinMocks.getAllBotList.mockReturnValue([])
    karinMocks.dbGet.mockResolvedValue(undefined)
    karinMocks.dbSet.mockResolvedValue(undefined)
    karinMocks.dbDel.mockResolvedValue(undefined)
    karinMocks.getLocalCommitHash.mockResolvedValue('local123')
    karinMocks.getRemoteCommitHash.mockResolvedValue('remote456')
    karinMocks.exec.mockResolvedValue({ status: true, error: null, stdout: '', stderr: '' })
  })

  it('accepts Hira update aliases', async () => {
    const { updateReg } = await importUpdate()

    expect(updateReg.test('#Hira更新')).toBe(true)
    expect(updateReg.test('hira更新')).toBe(true)
    expect(updateReg.test('#hi更新')).toBe(true)
    expect(updateReg.test('#kkk更新')).toBe(false)
  })

  it('resolves the git update target from a file dependency install', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hira-update-'))
    const appDir = path.join(tmp, 'karin-app')
    const sourceDir = path.join(tmp, 'karin-plugin-hira')
    const storeDir = path.join(appDir, 'node_modules', 'karin-plugin-hira')
    fs.mkdirSync(path.join(sourceDir, '.git'), { recursive: true })
    fs.mkdirSync(storeDir, { recursive: true })
    fs.mkdirSync(appDir, { recursive: true })
    fs.writeFileSync(path.join(appDir, 'package.json'), JSON.stringify({
      dependencies: {
        'karin-plugin-hira': 'file:../karin-plugin-hira'
      }
    }))
    const { resolveGitUpdateTarget } = await importUpdate()

    expect(resolveGitUpdateTarget(storeDir, appDir)).toEqual({
      path: sourceDir,
      refreshInstall: true
    })
  })

  it('updates the plugin and restarts after a newer version is available', async () => {
    karinMocks.checkPkgUpdate.mockResolvedValue({ status: 'yes', local: '0.1.0', remote: '0.2.0' })
    karinMocks.updatePkg.mockResolvedValue({ status: 'ok', data: 'ok', local: '0.1.0', remote: '0.2.0' })
    const e = createMessage()
    const { handleHiraUpdate } = await importUpdate()

    await handleHiraUpdate(e)

    expect(karinMocks.updatePkg).toHaveBeenCalledWith('karin-plugin-hira')
    expect(karinMocks.dbDel).toHaveBeenCalledWith('hira:update:msgId')
    expect(karinMocks.dbDel).toHaveBeenCalledWith('hira:update:lock')
    expect(karinMocks.restart).toHaveBeenCalledWith('bot-1', e.contact, 'reply-1')
    expect(e.reply).toHaveBeenCalledWith(expect.stringContaining('karin-plugin-hira 更新成功'))
  })

  it('falls back to git update when the package is not published to npm', async () => {
    karinMocks.checkPkgUpdate.mockResolvedValue({
      status: 'error',
      error: new Error('npm error code E404\nnpm error 404 Not Found - GET https://registry.npmjs.org/karin-plugin-hira - Not found')
    })
    karinMocks.checkGitPluginUpdate.mockResolvedValue({ status: 'yes', data: 'abc123 fix update', count: 1 })
    karinMocks.updateGitPlugin.mockResolvedValue({ status: 'ok', data: '更新成功', commit: 'abc123 fix update' })
    const e = createMessage()
    const { handleHiraUpdate } = await importUpdate()

    await handleHiraUpdate(e)

    expect(karinMocks.updatePkg).not.toHaveBeenCalled()
    expect(karinMocks.checkGitPluginUpdate).toHaveBeenCalled()
    expect(karinMocks.updateGitPlugin).toHaveBeenCalled()
    expect(karinMocks.restart).toHaveBeenCalledWith('bot-1', e.contact, 'reply-1')
    expect(karinMocks.render).toHaveBeenCalledWith(expect.objectContaining({
      name: 'karin-plugin-hira/card-update',
      selector: '#container',
      type: 'png'
    }))
    expect(e.reply).toHaveBeenCalledWith([
      expect.objectContaining({ type: 'image', file: `base64://${Buffer.from('update-card').toString('base64')}` })
    ], { reply: true })
    const html = readFirstRenderedHtml()
    expect(html).toMatch(/当前版本<\/div>\s*<div class="update-node-value">v0\.1\.0<\/div>/)
    expect(html).toContain('当前提交')
    expect(html).toContain('local123')
    expect(html).toContain('远程提交')
    expect(html).toContain('remote456')
    expect(html).not.toMatch(/当前版本<\/div>\s*<div class="update-node-value">local123<\/div>/)
    expect(e.reply).toHaveBeenCalledWith(expect.stringContaining('Git 更新成功'))
  })

  it('renders the git no-update result as a Hira update card', async () => {
    karinMocks.checkPkgUpdate.mockResolvedValue({
      status: 'error',
      error: new Error('npm error code E404\nnpm error 404 Not Found - GET https://registry.npmjs.org/karin-plugin-hira - Not found')
    })
    karinMocks.checkGitPluginUpdate.mockResolvedValue({ status: 'no', data: '', count: 0 })
    karinMocks.getLocalCommitHash.mockResolvedValue('d90d2e8')
    const e = createMessage()
    const { handleHiraUpdate } = await importUpdate()

    await handleHiraUpdate(e)

    expect(karinMocks.updatePkg).not.toHaveBeenCalled()
    expect(karinMocks.updateGitPlugin).not.toHaveBeenCalled()
    expect(karinMocks.render).toHaveBeenCalledWith(expect.objectContaining({
      name: 'karin-plugin-hira/card-update',
      selector: '#container',
      type: 'png'
    }))
    expect(e.reply).toHaveBeenCalledWith([
      expect.objectContaining({ type: 'image', file: `base64://${Buffer.from('update-card').toString('base64')}` })
    ], { reply: true })
    const html = readFirstRenderedHtml()
    expect(html).toMatch(/当前版本<\/div>\s*<div class="update-node-value">v0\.1\.0<\/div>/)
    expect(html).toContain('当前提交')
    expect(html).toContain('d90d2e8')
    expect(html).not.toMatch(/当前版本<\/div>\s*<div class="update-node-value">d90d2e8<\/div>/)
    expect(e.reply).not.toHaveBeenCalledWith(expect.stringContaining('当前已是最新版本：d90d2e8'), { reply: true })
  })

  it('uses package version rather than commit hash in git no-update text fallback', async () => {
    karinMocks.render.mockRejectedValueOnce(new Error('render offline'))
    karinMocks.checkPkgUpdate.mockResolvedValue({
      status: 'error',
      error: new Error('npm error code E404\nnpm error 404 Not Found - GET https://registry.npmjs.org/karin-plugin-hira - Not found')
    })
    karinMocks.checkGitPluginUpdate.mockResolvedValue({ status: 'no', data: '', count: 0 })
    karinMocks.getLocalCommitHash.mockResolvedValue('d90d2e8')
    const e = createMessage()
    const { handleHiraUpdate } = await importUpdate()

    await handleHiraUpdate(e)

    expect(e.reply).toHaveBeenCalledWith(expect.stringContaining('当前版本：v0.1.0'), { reply: true })
    expect(e.reply).toHaveBeenCalledWith(expect.stringContaining('当前提交：d90d2e8'), { reply: true })
    expect(e.reply).not.toHaveBeenCalledWith(expect.stringContaining('当前已是最新版本：d90d2e8'), { reply: true })
  })

  it('does not update when Karin reports yes but the remote semver is not newer', async () => {
    karinMocks.checkPkgUpdate.mockResolvedValue({ status: 'yes', local: '1.0.0-beta.2', remote: '1.0.0-beta.1' })
    const e = createMessage()
    const { handleHiraUpdate } = await importUpdate()

    await handleHiraUpdate(e)

    expect(karinMocks.updatePkg).not.toHaveBeenCalled()
    expect(karinMocks.render).toHaveBeenCalledWith(expect.objectContaining({
      name: 'karin-plugin-hira/card-update',
      selector: '#container',
      type: 'png'
    }))
    expect(e.reply).toHaveBeenCalledWith([
      expect.objectContaining({ type: 'image', file: `base64://${Buffer.from('update-card').toString('base64')}` })
    ], { reply: true })
    expect(e.reply).not.toHaveBeenCalledWith(expect.stringContaining('当前已是最新或预览版本：1.0.0-beta.2'), { reply: true })
  })

  it('pushes one update reminder to matched masters and stores the reply hook message id', async () => {
    const getFriendList = vi.fn(async () => [{ userId: 'owner-1' }])
    karinMocks.checkPkgUpdate.mockResolvedValue({ status: 'yes', local: '0.1.0', remote: '0.2.0' })
    karinMocks.master.mockReturnValue(['owner-1', 'console'])
    karinMocks.getAllBotList.mockReturnValue([
      { bot: { account: { selfId: 'bot-1', name: 'bot' }, getFriendList } }
    ])
    karinMocks.sendMaster.mockResolvedValue({ messageId: 'notice-1' })
    const { checkAndNotifyUpdate } = await importUpdate()

    await checkAndNotifyUpdate()

    expect(karinMocks.dbSet).toHaveBeenCalledWith('hira:update:lock', '0.2.0')
    expect(karinMocks.sendMaster).toHaveBeenCalledWith('bot-1', 'owner-1', [
      expect.objectContaining({ type: 'text', text: expect.stringContaining('karin-plugin-hira 有新的更新') }),
      expect.objectContaining({ type: 'image', file: `base64://${Buffer.from('update-card').toString('base64')}` })
    ])
    expect(karinMocks.dbSet).toHaveBeenCalledWith('hira:update:msgId', 'notice-1')
  })

  it('keeps git update reminder text fallback semantically separate from commit hashes', async () => {
    karinMocks.render.mockRejectedValueOnce(new Error('render offline'))
    const getFriendList = vi.fn(async () => [{ userId: 'owner-1' }])
    karinMocks.checkPkgUpdate.mockResolvedValue({
      status: 'error',
      error: new Error('npm error code E404\nnpm error 404 Not Found - GET https://registry.npmjs.org/karin-plugin-hira - Not found')
    })
    karinMocks.checkGitPluginUpdate.mockResolvedValue({ status: 'yes', data: 'remote456 fix update', count: 2 })
    karinMocks.getLocalCommitHash.mockResolvedValue('local123')
    karinMocks.getRemoteCommitHash.mockResolvedValue('remote456')
    karinMocks.master.mockReturnValue(['owner-1', 'console'])
    karinMocks.getAllBotList.mockReturnValue([
      { bot: { account: { selfId: 'bot-1', name: 'bot' }, getFriendList } }
    ])
    const { checkAndNotifyUpdate } = await importUpdate()

    await checkAndNotifyUpdate()

    expect(karinMocks.sendMaster).toHaveBeenCalledWith('bot-1', 'owner-1', [
      expect.objectContaining({
        type: 'text',
        text: expect.stringContaining('当前版本：v0.1.0')
      })
    ])
    const text = karinMocks.sendMaster.mock.calls[0]?.[2]?.[0]?.text as string
    expect(text).toContain('当前提交：local123')
    expect(text).toContain('远程提交：remote456')
    expect(text).not.toContain('当前版本：local123')
    expect(text).not.toContain('最新版本：remote456')
  })

  it('runs update from a friend reply to the stored update reminder', async () => {
    karinMocks.dbGet.mockResolvedValue('notice-1')
    karinMocks.checkPkgUpdate.mockResolvedValue({ status: 'yes', local: '0.1.0', remote: '0.2.0' })
    karinMocks.updatePkg.mockResolvedValue({ status: 'ok', data: 'ok', local: '0.1.0', remote: '0.2.0' })
    const next = vi.fn()
    const e = createMessage()
    e.msg = '更新'
    e.replyId = 'notice-1'
    const { handleHiraUpdateReply } = await importUpdate()

    await handleHiraUpdateReply(e, next)

    expect(karinMocks.updatePkg).toHaveBeenCalledWith('karin-plugin-hira')
    expect(next).toHaveBeenCalled()
  })
})
