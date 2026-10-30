import { describe, expect, it } from 'vitest'

import { buildXiaoheiheGameCard, normalizeXiaoheiheGame } from '@/resolvers/xiaoheihe'

describe('normalizeXiaoheiheGame', () => {
  it('normalizes game detail cards', () => {
    const result = normalizeXiaoheiheGame('https://www.xiaoheihe.cn/app/topic/game/pc/730', 'pc', {
      status: 'ok',
      result: {
        game: {
          name: 'Half-Life',
          desc: '经典游戏',
          score: 9.8,
          price: { current: 0 },
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
    expect(result.description).toContain('平台：Steam')
  })

  it('reads the price object instead of interpolating it into [object Object]', () => {
    const result = normalizeXiaoheiheGame('https://www.xiaoheihe.cn/app/topic/game/pc/730', 'pc', {
      status: 'ok',
      result: {
        game: {
          name: '赛博朋克 2077',
          game_type: 'pc',
          price: {
            current: 149,
            initial: 298,
            discount: 50,
            lowest_price: 99,
            lowest_discount: 67,
            deadline_date: '2026-11-11'
          },
          heybox_price: { cost_coin: 12900, discount: 10, original_coin: 14300 },
          cover: 'https://img/cover.jpg'
        }
      }
    })

    expect('ok' in result).toBe(false)
    if ('ok' in result) throw new Error('expected successful result')
    expect(result.description).not.toContain('[object Object]')
    expect(result.description).toContain('价格：¥149')

    const blocks = result.extras?.contentBlocks ?? []
    const priceBlock = blocks.find(block => block.type === 'text' && block.text.includes('价格信息'))
    expect(priceBlock).toBeDefined()
    if (!priceBlock || priceBlock.type !== 'text') throw new Error('expected price block')
    expect(priceBlock.text).toContain('当前价格: ¥149 (原价: ¥298, -50%)')
    expect(priceBlock.text).toContain('史低价格: ¥99 (-67%)')
    expect(priceBlock.text).toContain('优惠截止: 2026-11-11')
    expect(priceBlock.text).toContain('小黑盒商城: 12.9 盒币')
  })

  it('keeps console region prices, community stats, screenshots, and the trailer', () => {
    const result = normalizeXiaoheiheGame('https://www.xiaoheihe.cn/app/topic/game/console/100', 'console', {
      status: 'ok',
      result: {
        game: {
          name: '塞尔达传说',
          name_en: 'The Legend of Zelda',
          game_type: 'console',
          score: 9.6,
          region_prices: [
            {
              region_name: '香港',
              final_amount: 'HKD 429',
              initial_amount: 'HKD 529',
              discount: 19,
              lowest_price: 'HKD 399'
            }
          ],
          comment_stats: { score_comment: 3200, star_5: '92' },
          menu_v2: [
            { type: 'release_date', value: '2017-03-03' },
            { type: 'developer', value: 'Nintendo' },
            { type: 'dlc', value: '英杰们的诗篇' }
          ],
          common_tags: [{ desc: '开放世界', type: 'tag' }],
          about_the_game: '<p>海拉鲁大陆的冒险</p>',
          screenshots: [
            { type: 'image', url: 'https://img/shot.jpg?x=1' },
            { type: 'movie', url: 'https://video/trailer.mp4' }
          ]
        }
      }
    })

    expect('ok' in result).toBe(false)
    if ('ok' in result) throw new Error('expected successful result')
    expect(result.description).toContain('价格：HKD 429 (香港)')
    expect(result.images).toEqual(['https://img/shot.jpg?x=1\\'])
    expect(result.videos).toEqual([{ url: 'https://video/trailer.mp4' }])

    const texts = (result.extras?.contentBlocks ?? [])
      .filter(block => block.type === 'text')
      .map(block => block.type === 'text' ? block.text : '')
      .join('\n')
    expect(texts).toContain('发行日期: 2017-03-03')
    expect(texts).toContain('开发商: Nintendo')
    expect(texts).toContain('地区价格')
    expect(texts).toContain('香港: HKD 429 (原价: HKD 529, -19%) / 史低: HKD 399')
    expect(texts).toContain('玩家好评率: 92%')
    expect(texts).toContain('热门标签: #开放世界')
    expect(texts).toContain('DLCs信息')
    expect(texts).toContain('海拉鲁大陆的冒险')
  })

  it('builds a compact game card from the game API payload', () => {
    expect(buildXiaoheiheGameCard({
      status: 'ok',
      result: {
        game: {
          name: '黑神话：悟空',
          score: '9.5',
          comment_stats: { score_comment: 8800 },
          price: { current: 268 },
          image: 'https://img/wukong.jpg?x=1'
        }
      }
    }, 'pc')).toEqual({
      name: '黑神话：悟空',
      score: '9.5',
      scoreComment: 8800,
      price: '¥268',
      cover: 'https://img/wukong.jpg?x=1\\'
    })
  })
})
