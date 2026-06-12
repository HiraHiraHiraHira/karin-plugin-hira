import type { Message } from 'node-karin'
import { describe, expect, it, vi } from 'vitest'

const karinMocks = vi.hoisted(() => ({
  render: vi.fn(async () => Buffer.from('cookie-card').toString('base64'))
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

describe('music cookie controller', () => {
  it('renders cookie status as a card image for privileged users', async () => {
    const { handleMusicCookieMessage } = await import('@/music/cookieController')
    const reply = vi.fn(async () => ({}))
    const e = {
      msg: '#点歌ck检查',
      isMaster: true,
      reply
    } as unknown as Message

    await handleMusicCookieMessage(e)

    expect(karinMocks.render).toHaveBeenCalledWith(expect.objectContaining({
      name: 'karin-plugin-hira/card-music-cookie-status',
      selector: '#container',
      type: 'png'
    }))
    expect(reply).toHaveBeenCalledWith([
      { type: 'image', file: `base64://${Buffer.from('cookie-card').toString('base64')}` }
    ])
  })
})
