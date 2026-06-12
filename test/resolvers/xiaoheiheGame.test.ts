import { describe, expect, it } from 'vitest'

import { normalizeXiaoheiheGame } from '@/resolvers/xiaoheihe'

describe('normalizeXiaoheiheGame', () => {
  it('normalizes game detail cards', () => {
    const result = normalizeXiaoheiheGame('https://www.xiaoheihe.cn/app/topic/game/pc/730', 'pc', {
      status: 'ok',
      result: {
        game: {
          name: 'Half-Life',
          desc: '经典游戏',
          score: 9.8,
          price: '免费',
          platforms: ['Steam'],
          cover: 'https://img/cover.jpg'
        }
      }
    })

    expect(result).toMatchObject({
      platform: 'xiaoheihe',
      displayName: '小黑盒游戏',
      title: 'Half-Life',
      images: ['https://img/cover.jpg']
    })
    expect('ok' in result).toBe(false)
    if ('ok' in result) throw new Error('expected successful result')
    expect(result.description).toContain('评分：9.8')
    expect(result.description).toContain('价格：免费')
    expect(result.description).toContain('平台：Steam')
  })
})
