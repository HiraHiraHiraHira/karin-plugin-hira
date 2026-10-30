import { describe, expect, it } from 'vitest'

import { extractQuotedMusicCard, findQuotedMessageId, readMessageElements } from '@/music/quotedCard'

const cardJson = JSON.stringify({
  view: 'music',
  meta: {
    music: {
      title: '晴天',
      desc: '周杰伦',
      musicUrl: 'https://music.example.test/q.mp3',
      jumpUrl: 'https://y.qq.com/n/ryqq/songDetail/x'
    }
  }
})

describe('findQuotedMessageId', () => {
  it('reads the reply element id', () => {
    expect(findQuotedMessageId([{ type: 'text', text: 'x' }, { type: 'reply', messageId: 'm1' }])).toBe('m1')
    expect(findQuotedMessageId([{ type: 'text', text: 'x' }])).toBeUndefined()
    expect(findQuotedMessageId(undefined)).toBeUndefined()
  })
})

describe('readMessageElements', () => {
  it('prefers elements and falls back to message', () => {
    expect(readMessageElements({ elements: [{ type: 'text' }] })).toEqual([{ type: 'text' }])
    expect(readMessageElements({ message: [{ type: 'json' }] })).toEqual([{ type: 'json' }])
    expect(readMessageElements({})).toBeUndefined()
  })
})

describe('extractQuotedMusicCard', () => {
  it('parses string and object json music cards', () => {
    expect(extractQuotedMusicCard([{ type: 'json', data: cardJson }])).toEqual({
      title: '晴天',
      desc: '周杰伦',
      musicUrl: 'https://music.example.test/q.mp3',
      jumpUrl: 'https://y.qq.com/n/ryqq/songDetail/x'
    })
    expect(extractQuotedMusicCard([{ type: 'json', data: JSON.parse(cardJson) }])).toMatchObject({ title: '晴天' })
  })

  it('ignores non-music or malformed json elements', () => {
    expect(extractQuotedMusicCard([{ type: 'json', data: '{"view":"news"}' }])).toBeUndefined()
    expect(extractQuotedMusicCard([{ type: 'json', data: 'not json' }])).toBeUndefined()
    expect(extractQuotedMusicCard([
      { type: 'json', data: JSON.stringify({ view: 'music', meta: { music: { title: '无直链' } } }) }
    ])).toBeUndefined()
    expect(extractQuotedMusicCard([{ type: 'text', text: cardJson }])).toBeUndefined()
  })
})
