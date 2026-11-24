import { describe, expect, it } from 'vitest'

import { isSwitchCommand, notSwitchCommandSource, parseSwitchCommand, switchCommandReg } from '@/switches/commandParser'

describe('开关命令解析', () => {
  it('识别各模块的开启/关闭', () => {
    expect(parseSwitchCommand('#点歌关闭')).toEqual({ type: 'toggle', groupId: undefined, moduleId: 'music', enabled: false })
    expect(parseSwitchCommand('#点歌开启')).toEqual({ type: 'toggle', groupId: undefined, moduleId: 'music', enabled: true })
    expect(parseSwitchCommand('#解析关')).toEqual({ type: 'toggle', groupId: undefined, moduleId: 'resolve', enabled: false })
    expect(parseSwitchCommand('#B站关闭')).toEqual({ type: 'toggle', groupId: undefined, moduleId: 'resolve:bilibili', enabled: false })
    expect(parseSwitchCommand('#b站开启')).toEqual({ type: 'toggle', groupId: undefined, moduleId: 'resolve:bilibili', enabled: true })
    expect(parseSwitchCommand('#抖音禁用')).toEqual({ type: 'toggle', groupId: undefined, moduleId: 'resolve:douyin', enabled: false })
    expect(parseSwitchCommand('#猫图关闭')).toEqual({ type: 'toggle', groupId: undefined, moduleId: 'light:cat', enabled: false })
    expect(parseSwitchCommand('#买家秀关闭')).toEqual({ type: 'toggle', groupId: undefined, moduleId: 'light:buyer', enabled: false })
    expect(parseSwitchCommand('#累了关闭')).toEqual({ type: 'toggle', groupId: undefined, moduleId: 'light:tired', enabled: false })
    expect(parseSwitchCommand('#娱乐关闭')).toEqual({ type: 'toggle', groupId: undefined, moduleId: 'light:fun', enabled: false })
    expect(parseSwitchCommand('#医药关闭')).toEqual({ type: 'toggle', groupId: undefined, moduleId: 'light:query', enabled: false })
    expect(parseSwitchCommand('#翻译关闭')).toEqual({ type: 'toggle', groupId: undefined, moduleId: 'translate', enabled: false })
    expect(parseSwitchCommand('#总结关闭')).toEqual({ type: 'toggle', groupId: undefined, moduleId: 'summary', enabled: false })
  })

  it('长命令词优先，不被短别名截断', () => {
    // 通用解析 / 通用；通用解析关闭 必须落到 resolve:general
    expect(parseSwitchCommand('#通用解析关闭')).toEqual({ type: 'toggle', groupId: undefined, moduleId: 'resolve:general', enabled: false })
    // 关闭 不能被 关 抢先切
    expect(parseSwitchCommand('#点歌关闭')).toMatchObject({ enabled: false })
    // 点歌功能关闭 允许带「功能」后缀
    expect(parseSwitchCommand('#点歌功能关闭')).toEqual({ type: 'toggle', groupId: undefined, moduleId: 'music', enabled: false })
  })

  it('状态查询', () => {
    expect(parseSwitchCommand('#开关')).toEqual({ type: 'status', groupId: undefined })
    expect(parseSwitchCommand('#点歌开关')).toEqual({ type: 'status', groupId: undefined, moduleId: 'music' })
    expect(parseSwitchCommand('#群477640404 开关')).toEqual({ type: 'status', groupId: '477640404' })
  })

  it('全部开关 + 远程指定群', () => {
    expect(parseSwitchCommand('#全部关闭')).toEqual({ type: 'all', groupId: undefined, enabled: false })
    expect(parseSwitchCommand('#全部开启')).toEqual({ type: 'all', groupId: undefined, enabled: true })
    expect(parseSwitchCommand('#群477640404 点歌关闭')).toEqual({
      type: 'toggle',
      groupId: '477640404',
      moduleId: 'music',
      enabled: false
    })
  })

  it('不误伤正常命令', () => {
    for (const message of ['#点歌 晴天', '#点歌', '#解析 https://b23.tv/xxx', '#cat', '翻中hello', '#开关状态']) {
      expect(switchCommandReg.test(message)).toBe(false)
      expect(isSwitchCommand(message)).toBe(false)
      expect(parseSwitchCommand(message).type).toBe('none')
    }
  })

  it('点歌正则的负向断言会把开关命令让出去', () => {
    // 与 musicReg 首部的 notSwitchCommandSource 同源，这里直接验证纯正则行为
    const musicLike = new RegExp(`^${notSwitchCommandSource}#?(?:点歌|来首)(?:\\s*[\\s\\S]*)`, 'i')
    expect(musicLike.test('#点歌关闭')).toBe(false)
    expect(musicLike.test('#点歌开启')).toBe(false)
    expect(musicLike.test('#点歌开关')).toBe(false)
    expect(musicLike.test('#群477640404 点歌关闭')).toBe(false)
    // 正常点歌仍然匹配
    expect(musicLike.test('#点歌 晴天')).toBe(true)
    expect(musicLike.test('#点歌关闭 晴天')).toBe(true)
  })
})
