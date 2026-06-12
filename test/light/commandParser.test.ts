import { describe, expect, it } from 'vitest'

import { parseLightCommand } from '@/light/commandParser'

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
})
