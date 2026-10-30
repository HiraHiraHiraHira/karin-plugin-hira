import type { Message } from 'node-karin'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { handleMusicCookieMessage } from '@/music/cookieController'

const karinMocks = vi.hoisted(() => ({
  render: vi.fn(async () => Buffer.from('cookie-card').toString('base64'))
}))

const configMocks = vi.hoisted(() => ({
  updateMusicCookie: vi.fn()
}))

const statusMocks = vi.hoisted(() => ({
  validateMusicCookie: vi.fn()
}))

vi.mock('node-karin', async importOriginal => {
  const actual = await importOriginal<typeof import('node-karin')>()
  return {
    ...actual,
    render: {
      ...actual.render,
      render: karinMocks.render
    }
  }
})

vi.mock('@/apps/runtime', () => ({
  isHiraAppEnabled: () => true
}))

vi.mock('@/config', () => ({
  Config: {
    app: { replyPrefix: 'Hira' },
    music: {
      cookies: { netease: '', qq: '', kuwo: '', kugou: '', bilibili: '' },
      api: { neteaseBaseUrl: 'https://music.163.com/api', qqTempApi: '' }
    }
  },
  updateMusicCookie: configMocks.updateMusicCookie
}))

vi.mock('@/music/cookieStatus', async importOriginal => {
  const actual = await importOriginal<typeof import('@/music/cookieStatus')>()
  return {
    ...actual,
    validateMusicCookie: statusMocks.validateMusicCookie
  }
})

const eventOf = (msg: string, overrides: Record<string, unknown> = {}) => {
  const reply = vi.fn(async (..._args: unknown[]) => ({}))
  const event = {
    msg,
    isMaster: true,
    reply,
    ...overrides
  }
  return event as unknown as Message & { reply: typeof reply }
}

beforeEach(() => {
  vi.clearAllMocks()
  statusMocks.validateMusicCookie.mockResolvedValue({ checkable: true, ok: true, message: 'Hira', vip: true })
})

describe('music cookie controller', () => {
  it('renders cookie status as a card image for privileged users', async () => {
    const e = eventOf('#点歌ck检查')

    await handleMusicCookieMessage(e)

    expect(karinMocks.render).toHaveBeenCalledWith(expect.objectContaining({
      name: 'karin-plugin-hira/card-music-cookie-status',
      selector: '#container',
      type: 'png'
    }))
    expect(e.reply).toHaveBeenCalledWith([
      { type: 'image', file: `base64://${Buffer.from('cookie-card').toString('base64')}` }
    ])
  })

  it('accepts legacy single-segment submit, validates and reports account/VIP', async () => {
    const e = eventOf('#提交音乐ckMUSIC_U=abc')

    await handleMusicCookieMessage(e)

    expect(statusMocks.validateMusicCookie).toHaveBeenCalledWith(expect.anything(), 'netease', 'MUSIC_U=abc')
    expect(configMocks.updateMusicCookie).toHaveBeenCalledWith('netease', 'MUSIC_U=abc')
    expect(String(e.reply.mock.calls[0]?.[0])).toContain('网易云')
    expect(String(e.reply.mock.calls[0]?.[0])).toContain('账号：Hira')
    expect(String(e.reply.mock.calls[0]?.[0])).toContain('是否VIP：是')
  })

  it('does not save an invalid cookie', async () => {
    statusMocks.validateMusicCookie.mockResolvedValueOnce({ checkable: true, ok: false, message: 'Cookie 失效或未登录' })
    const e = eventOf('#提交音乐ck uin=1; qm_keyst=secret')

    await handleMusicCookieMessage(e)

    expect(configMocks.updateMusicCookie).not.toHaveBeenCalled()
    expect(String(e.reply.mock.calls[0]?.[0])).toContain('不正确或已失效')
  })

  it('saves cookies for sources without a validation API', async () => {
    statusMocks.validateMusicCookie.mockResolvedValueOnce({ checkable: false, ok: true })
    const e = eventOf('#提交音乐ck 酷我 kw_token=secret')

    await handleMusicCookieMessage(e)

    expect(configMocks.updateMusicCookie).toHaveBeenCalledWith('kuwo', 'kw_token=secret')
  })

  it('silently passes non-privileged users through', async () => {
    const next = vi.fn()
    const e = eventOf('#点歌ck检查', { isMaster: false, isAdmin: false })

    await handleMusicCookieMessage(e, next)

    expect(next).toHaveBeenCalledTimes(1)
    expect(e.reply).not.toHaveBeenCalled()
  })

  it('saves the cookie even when the validation API throws', async () => {
    statusMocks.validateMusicCookie.mockRejectedValueOnce(new Error('ETIMEDOUT'))
    const e = eventOf('#提交音乐ckMUSIC_U=abc')

    await handleMusicCookieMessage(e)

    expect(configMocks.updateMusicCookie).toHaveBeenCalledWith('netease', 'MUSIC_U=abc')
    expect(String(e.reply.mock.calls[0]?.[0])).toContain('已更新')
    expect(String(e.reply.mock.calls[0]?.[0])).not.toContain('不正确')
  })

  it('replies with usage help when the submit command has no cookie', async () => {
    const e = eventOf('#提交音乐ck')

    await handleMusicCookieMessage(e)

    expect(statusMocks.validateMusicCookie).not.toHaveBeenCalled()
    expect(String(e.reply.mock.calls[0]?.[0])).toContain('自动识别')
  })
})
