import { describe, expect, it } from 'vitest'

import { buildOidbMusicPacket, oidbSupportedSource } from '@/services/musicOidb'

const readVarint = (buffer: Buffer, offset: number): [bigint, number] => {
  let result = 0n
  let shift = 0n
  let index = offset
  for (;;) {
    const byte = buffer[index++]!
    result |= BigInt(byte & 0x7f) << shift
    if ((byte & 0x80) === 0) return [result, index]
    shift += 7n
  }
}

type Field = { wire: number, value: bigint | Buffer }

const parseFields = (buffer: Buffer): Map<number, Field> => {
  const fields = new Map<number, Field>()
  let index = 0
  while (index < buffer.length) {
    const [key, afterKey] = readVarint(buffer, index)
    index = afterKey
    const field = Number(key >> 3n)
    const wire = Number(key & 0x7n)
    if (wire === 0) {
      const [value, afterValue] = readVarint(buffer, index)
      index = afterValue
      fields.set(field, { wire, value })
    } else if (wire === 2) {
      const [length, afterLength] = readVarint(buffer, index)
      const end = afterLength + Number(length)
      fields.set(field, { wire, value: buffer.subarray(afterLength, end) })
      index = end
    } else if (wire === 5) {
      index += 4
    } else if (wire === 1) {
      index += 8
    } else {
      throw new Error(`unexpected wire type ${wire}`)
    }
  }
  return fields
}

const uint = (fields: Map<number, Field>, field: number) => {
  const value = fields.get(field)?.value
  if (typeof value !== 'bigint') throw new Error(`field ${field} 不是 uint`)
  return value
}

const text = (fields: Map<number, Field>, field: number) => {
  const value = fields.get(field)?.value
  if (!Buffer.isBuffer(value)) throw new Error(`field ${field} 不是字符串`)
  return value.toString('utf8')
}

const message = (fields: Map<number, Field>, field: number) => {
  const value = fields.get(field)?.value
  if (!Buffer.isBuffer(value)) throw new Error(`field ${field} 不是子消息`)
  return parseFields(value)
}

describe('OIDB 音乐卡片', () => {
  it('支持 QQ音乐/网易云/酷狗/酷我/B站', () => {
    for (const source of ['qq', 'netease', 'kugou', 'kuwo', 'bilibili']) {
      expect(oidbSupportedSource(source)).toBe(true)
    }
    expect(oidbSupportedSource('unknown')).toBe(false)
  })

  it('按小飞的 0xb77_9 结构编码群聊卡片', () => {
    const packet = buildOidbMusicPacket('qq', { sendType: 1, peer: 853065300n }, {
      title: '青花瓷',
      singer: '周杰伦',
      jumpUrl: 'https://y.qq.com/n/ryqq/songDetail/002qU5aY3Qu24y',
      preview: 'https://y.qq.com/music/photo_new/T002R300x300M000002sC7IV44gj7V_3.jpg',
      musicUrl: 'https://example.com/audio.m4a'
    })

    const fields = parseFields(packet)
    expect(uint(fields, 1)).toBe(100497308n)
    expect(uint(fields, 2)).toBe(1n)
    // 4 = 带音频的分享卡
    expect(uint(fields, 3)).toBe(4n)
    expect(uint(fields, 10)).toBe(1n)
    expect(uint(fields, 11)).toBe(853065300n)

    const app = message(fields, 5)
    expect(uint(app, 1)).toBe(1n)
    expect(text(app, 2)).toBe('0.0.0')
    expect(text(app, 3)).toBe('com.tencent.qqmusic')
    expect(text(app, 4)).toBe('cbd27cd7c861227d013a25b2d10f0799')

    const music = message(fields, 12)
    expect(text(music, 10)).toBe('青花瓷')
    expect(text(music, 11)).toBe('周杰伦')
    expect(text(music, 13)).toBe('https://y.qq.com/n/ryqq/songDetail/002qU5aY3Qu24y')
    expect(text(music, 16)).toBe('https://example.com/audio.m4a')
  })

  it('没有音频直链时降级成纯链接卡', () => {
    const packet = buildOidbMusicPacket('netease', { sendType: 0, peer: 10001n }, {
      title: '晴天',
      singer: '周杰伦',
      jumpUrl: 'https://music.163.com/song?id=186016',
      preview: '',
      musicUrl: ''
    })
    const fields = parseFields(packet)
    expect(uint(fields, 3)).toBe(0n)
    expect(uint(fields, 10)).toBe(0n)
    expect(uint(fields, 11)).toBe(10001n)
    expect(text(message(fields, 5), 3)).toBe('com.netease.cloudmusic')
  })
})
