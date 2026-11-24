import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it, vi } from 'vitest'

// 群开关文件写到 test-output 下，避免污染真实 @karinjs 目录
const testBase = vi.hoisted(() => `${process.cwd()}/test-output/.tmp-group-switches-${process.pid}-${Date.now()}`)

vi.mock('node-karin/root', () => ({ karinPathBase: testBase, karinPathTemp: `${testBase}/temp` }))

const dataFile = path.join(testBase, 'karin-plugin-hira', 'data', 'group-switches.json')

const reset = () => {
  fs.rmSync(testBase, { recursive: true, force: true })
}

describe('群级功能开关存储', () => {
  it('默认全部开启，关闭后能读回', async () => {
    reset()
    const store = await import('@/switches/store')

    expect(store.isModuleEnabled('1000', '555', 'music')).toBe(true)

    const changed = store.applySwitchChanges('1000', '555', [{ moduleId: 'music', enabled: false }], '42')
    expect(changed).toEqual([{ moduleId: 'music', enabled: false }])
    expect(store.isModuleEnabled('1000', '555', 'music')).toBe(false)
    // 其它群不受影响
    expect(store.isModuleEnabled('1000', '666', 'music')).toBe(true)

    const saved = JSON.parse(fs.readFileSync(dataFile, 'utf8'))
    expect(saved['1000:555'].disabled).toEqual(['music'])
    expect(saved['1000:555'].updatedBy).toBe('42')
  })

  it('关掉上位模块后下位模块一并失效，重新开启后恢复', async () => {
    reset()
    const store = await import('@/switches/store')

    store.applySwitchChanges('1000', '555', [{ moduleId: 'resolve', enabled: false }])
    expect(store.isModuleEnabled('1000', '555', 'resolve')).toBe(false)
    expect(store.isModuleEnabled('1000', '555', 'resolve:bilibili')).toBe(false)

    store.applySwitchChanges('1000', '555', [{ moduleId: 'resolve', enabled: true }])
    expect(store.isModuleEnabled('1000', '555', 'resolve:bilibili')).toBe(true)
  })

  it('只关单个平台不影响其它平台', async () => {
    reset()
    const store = await import('@/switches/store')

    store.applySwitchChanges('1000', '555', [{ moduleId: 'resolve:douyin', enabled: false }])
    expect(store.isModuleEnabled('1000', '555', 'resolve:douyin')).toBe(false)
    expect(store.isModuleEnabled('1000', '555', 'resolve:bilibili')).toBe(true)
    expect(store.isModuleEnabled('1000', '555', 'resolve')).toBe(true)
  })

  it('关上位模块会清掉下位模块的残留记录', async () => {
    reset()
    const store = await import('@/switches/store')

    store.applySwitchChanges('1000', '555', [{ moduleId: 'resolve:bilibili', enabled: false }])
    store.applySwitchChanges('1000', '555', [{ moduleId: 'resolve', enabled: false }])
    store.applySwitchChanges('1000', '555', [{ moduleId: 'resolve', enabled: true }])

    // 重新打开「解析」后不该再莫名其妙只剩 B站 关着
    expect(store.isModuleEnabled('1000', '555', 'resolve:bilibili')).toBe(true)
  })

  it('重复设置同状态不算变化，文件保持干净', async () => {
    reset()
    const store = await import('@/switches/store')

    expect(store.applySwitchChanges('1000', '555', [{ moduleId: 'music', enabled: true }])).toEqual([])
    expect(fs.existsSync(dataFile)).toBe(false)

    store.applySwitchChanges('1000', '555', [{ moduleId: 'music', enabled: false }])
    store.applySwitchChanges('1000', '555', [{ moduleId: 'music', enabled: true }])
    // 全部开启后删除该群记录
    expect(JSON.parse(fs.readFileSync(dataFile, 'utf8'))).toEqual({})
  })

  it('手改文件后立即生效（按 mtime 失效缓存）', async () => {
    reset()
    const store = await import('@/switches/store')

    store.applySwitchChanges('1000', '555', [{ moduleId: 'music', enabled: false }])
    expect(store.isModuleEnabled('1000', '555', 'music')).toBe(false)

    fs.writeFileSync(dataFile, JSON.stringify({ '1000:555': { disabled: [] } }, null, 2))
    // 保证 mtime 变化在粗粒度文件系统上也可见
    const later = Date.now() / 1000 + 2
    fs.utimesSync(dataFile, later, later)

    expect(store.isModuleEnabled('1000', '555', 'music')).toBe(true)
  })

  it('快照能标出被上位模块连带关闭的模块', async () => {
    reset()
    const store = await import('@/switches/store')

    store.applySwitchChanges('1000', '555', [{ moduleId: 'resolve', enabled: false }])
    const items = store.snapshotGroupSwitches('1000', '555')
    const bilibili = items.find(item => item.id === 'resolve:bilibili')

    expect(bilibili?.enabled).toBe(false)
    expect(bilibili?.mutedBy).toBe('解析（全部平台）')
  })

  it('娱乐下三条命令各自独立，关累了不影响猫图', async () => {
    reset()
    const store = await import('@/switches/store')

    store.applySwitchChanges('1000', '555', [{ moduleId: 'light:tired', enabled: false }])
    expect(store.isModuleEnabled('1000', '555', 'light:tired')).toBe(false)
    // 同组的猫图、买家秀照常
    expect(store.isModuleEnabled('1000', '555', 'light:cat')).toBe(true)
    expect(store.isModuleEnabled('1000', '555', 'light:buyer')).toBe(true)
    expect(store.isModuleEnabled('1000', '555', 'light:fun')).toBe(true)
    expect(store.isModuleEnabled('1000', '555', 'light:query')).toBe(true)
  })

  it('关娱乐整组会连带停掉猫图/买家秀/累了', async () => {
    reset()
    const store = await import('@/switches/store')

    store.applySwitchChanges('1000', '555', [{ moduleId: 'light:fun', enabled: false }])
    for (const id of ['light:fun', 'light:cat', 'light:buyer', 'light:tired']) {
      expect(store.isModuleEnabled('1000', '555', id)).toBe(false)
    }
    // 查询不受影响
    expect(store.isModuleEnabled('1000', '555', 'light:query')).toBe(true)
  })

  it('关轻量整块会连带停掉娱乐和查询', async () => {
    reset()
    const store = await import('@/switches/store')

    store.applySwitchChanges('1000', '555', [{ moduleId: 'light', enabled: false }])
    for (const id of ['light', 'light:fun', 'light:tired', 'light:query']) {
      expect(store.isModuleEnabled('1000', '555', id)).toBe(false)
    }
  })

  it('整组关着时单开下位不生效，必须先开上位', async () => {
    reset()
    const store = await import('@/switches/store')

    // 上一版本只有 light:fun 这一层，老文件里的值不能失效
    store.applySwitchChanges('1000', '555', [{ moduleId: 'light:fun', enabled: false }])
    expect(store.isModuleEnabled('1000', '555', 'light:cat')).toBe(false)

    // 上位还关着，单开猫图不生效——提示用户先 #娱乐开启
    store.applySwitchChanges('1000', '555', [{ moduleId: 'light:cat', enabled: true }])
    expect(store.isModuleEnabled('1000', '555', 'light:cat')).toBe(false)

    store.applySwitchChanges('1000', '555', [{ moduleId: 'light:fun', enabled: true }])
    expect(store.isModuleEnabled('1000', '555', 'light:cat')).toBe(true)
  })
})
