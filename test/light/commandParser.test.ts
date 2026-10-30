import { describe, expect, it } from 'vitest'

import { lightCommandReg, parseLightCommand } from '@/light/commandParser'

describe('parseLightCommand', () => {
  it('parses simple media commands', () => {
    expect(parseLightCommand('#cat')).toEqual({ type: 'cat' })
    expect(parseLightCommand('#买家秀')).toEqual({ type: 'buyerShow' })
    expect(parseLightCommand('#累了')).toEqual({ type: 'tired' })
  })

  it('parses query commands', () => {
    expect(parseLightCommand('#医药查询 布洛芬')).toEqual({ type: 'medicine', keyword: '布洛芬' })
    expect(parseLightCommand('#推荐软件 截图')).toEqual({ type: 'software', keyword: '截图' })
  })

  it('医药查询/推荐软件允许空关键词', () => {
    expect(parseLightCommand('#医药查询')).toEqual({ type: 'medicine', keyword: '' })
    expect(parseLightCommand('推荐软件')).toEqual({ type: 'software', keyword: '' })
    expect(parseLightCommand('#推荐软件   ')).toEqual({ type: 'software', keyword: '' })
  })

  it('命令正则同时接受裸命令与带关键词写法', () => {
    expect(lightCommandReg.test('#推荐软件')).toBe(true)
    expect(lightCommandReg.test('#医药查询 布洛芬')).toBe(true)
    expect(lightCommandReg.test('#cat')).toBe(true)
    expect(lightCommandReg.test('#猫图')).toBe(false)
  })
})
