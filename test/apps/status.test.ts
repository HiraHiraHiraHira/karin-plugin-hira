import type { Message } from 'node-karin'
import { describe, expect, it, vi } from 'vitest'

const karinMocks = vi.hoisted(() => ({
  render: vi.fn(async () => Buffer.from('status-card').toString('base64')),
  command: vi.fn((_reg: unknown, handler: unknown, options: unknown) => ({ handler, options })),
  task: vi.fn((_name: unknown, _cron: unknown, handler: unknown, options: unknown) => ({ handler, options }))
}))

vi.mock('node-karin', async importOriginal => {
  const actual = await importOriginal<typeof import('node-karin')>()
  const patched = {
    ...actual.default,
    command: karinMocks.command,
    task: karinMocks.task
  }
  return {
    ...actual,
    default: patched,
    karin: patched,
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

  it('silently passes cleanup to the next handler for non-masters', async () => {
    const { cleanup } = await import('@/apps/status')
    const command = cleanup as unknown as {
      handler: (e: Message, next: () => unknown) => Promise<unknown>
      options: Record<string, unknown>
    }
    const next = vi.fn()
    const reply = vi.fn(async () => ({}))
    const e = { reply, isMaster: false } as unknown as Message

    await command.handler(e, next)

    expect(command.options.perm).toBeUndefined()
    expect(next).toHaveBeenCalledTimes(1)
    expect(reply).not.toHaveBeenCalled()
  })
})
