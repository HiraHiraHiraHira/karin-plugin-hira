import type { Message } from 'node-karin'
import { describe, expect, it, vi } from 'vitest'

const karinMocks = vi.hoisted(() => ({
  render: vi.fn(async () => Buffer.from('status-card').toString('base64'))
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

describe('status command', () => {
  it('renders status as a card image', async () => {
    const { replyStatus } = await import('@/apps/status')
    const reply = vi.fn(async () => ({}))
    const e = { reply } as unknown as Message

    await replyStatus(e)

    expect(karinMocks.render).toHaveBeenCalledWith(expect.objectContaining({
      name: 'karin-plugin-hira/card-status',
      selector: '#container',
      type: 'png'
    }))
    expect(reply).toHaveBeenCalledWith([
      { type: 'image', file: `base64://${Buffer.from('status-card').toString('base64')}` }
    ])
  })
})
