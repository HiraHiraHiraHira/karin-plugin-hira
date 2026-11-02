import { describe, expect, it, vi } from 'vitest'

const karinMocks = vi.hoisted(() => ({
  task: vi.fn((_name: string, _cron: string, handler: unknown, options: unknown) => ({ handler, options }))
}))

vi.mock('node-karin', async importOriginal => {
  const actual = await importOriginal<typeof import('node-karin')>()
  const mockedKarin = {
    ...actual.default,
    task: karinMocks.task
  }

  return {
    ...actual,
    default: mockedKarin,
    karin: mockedKarin
  }
})

vi.mock('@/runtime/temp', () => ({
  cleanupRuntimeTemp: vi.fn()
}))

// 任务必须从 apps/ 下的模块导出才会被 Karin 的 pkgCache 收集并 scheduleJob，
// 写在主入口 setup.ts 里的任务对象永远不会被调度，所以这里直接断言 apps/maintenance。
describe('定时清理任务', () => {
  it('注册每小时执行的临时目录清理任务', async () => {
    vi.clearAllMocks()
    vi.resetModules()

    const { tempCleanup } = await import('@/apps/maintenance')
    const { cleanupRuntimeTemp } = await import('@/runtime/temp')

    expect(karinMocks.task).toHaveBeenCalledTimes(1)
    expect(karinMocks.task).toHaveBeenCalledWith('hira-临时清理', '0 * * * *', cleanupRuntimeTemp, {
      name: 'hira-临时清理',
      log: false
    })
    expect(tempCleanup).toMatchObject({ options: { name: 'hira-临时清理', log: false } })
  })
})
