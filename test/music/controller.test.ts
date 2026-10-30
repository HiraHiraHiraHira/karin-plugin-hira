import type { Message } from 'node-karin'
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'

import type { MusicItem, MusicPlayable } from '@/music/types'

const karinMocks = vi.hoisted(() => ({
  recallMsg: vi.fn(async () => true)
}))

vi.mock('node-karin', async importOriginal => {
  const actual = await importOriginal<typeof import('node-karin')>()
  return {
    ...actual,
    default: {
      ...actual.default,
      getBot: () => ({ recallMsg: karinMocks.recallMsg })
    }
  }
})

vi.mock('@/apps/runtime', () => ({
  isHiraAppEnabled: () => true
}))

vi.mock('@/config', () => ({
  Config: {
    music: {
      enabled: true,
      defaultSource: 'qq',
      listModeDefault: false,
      pageSize: 20,
      sessionTtlSeconds: 180,
      voiceEnabled: true
    }
  }
}))

const providerMocks = vi.hoisted(() => ({
  search: vi.fn(),
  getPlayable: vi.fn(),
  getLyrics: vi.fn(),
  getPersonalized: vi.fn()
}))

vi.mock('@/music/providers', async importOriginal => {
  const actual = await importOriginal<typeof import('@/music/providers')>()
  const provider = {
    source: 'qq',
    search: providerMocks.search,
    getPlayable: providerMocks.getPlayable,
    getLyrics: providerMocks.getLyrics,
    getPersonalized: providerMocks.getPersonalized
  }
  return {
    ...actual,
    createMusicProviders: () => new Map([['qq', provider]])
  }
})

const messageMocks = vi.hoisted(() => ({
  replyText: vi.fn(async () => undefined),
  replyPlainText: vi.fn(async () => undefined),
  replyMusicList: vi.fn(async () => undefined as string | undefined),
  replyMusicPlayable: vi.fn(async () => undefined),
  replyVoiceFileOrAudio: vi.fn(async () => undefined as string | undefined)
}))

vi.mock('@/services/message', () => messageMocks)

const voiceMocks = vi.hoisted(() => ({
  resolveVoiceFile: vi.fn()
}))

vi.mock('@/music/voice', async importOriginal => {
  const actual = await importOriginal<typeof import('@/music/voice')>()
  return {
    ...actual,
    resolveVoiceFile: voiceMocks.resolveVoiceFile
  }
})

const item = (id: string, title = `song-${id}`): MusicItem => ({
  id,
  source: 'qq',
  title,
  artists: ['Hira'],
  pageUrl: `https://y.qq.com/n/ryqq/songDetail/${id}`
})

const playableOf = (music: MusicItem): MusicPlayable => ({
  item: music,
  audioUrl: `https://audio.example.test/${music.id}.mp3`
})

const eventOf = (msg: string, overrides: Record<string, unknown> = {}) => {
  const event = {
    msg,
    isGroup: false,
    userId: 'u1',
    selfId: 'bot1',
    elements: [],
    contact: { scene: 'friend', peer: 'u1', name: 'u1' },
    reply: vi.fn(async () => ({ messageId: 'sent-1' })),
    bot: {
      account: { selfId: 'bot1', name: 'Bot' },
      getMsg: vi.fn(),
      sendForwardMsg: vi.fn(async (..._args: unknown[]) => ({})),
      uploadFile: vi.fn(async () => undefined)
    },
    ...overrides
  }
  return event as unknown as Message & typeof event
}

const loadController = async () => import('@/music/controller')

let next: Mock

beforeEach(() => {
  vi.clearAllMocks()
  next = vi.fn()
  providerMocks.search.mockResolvedValue([item('s1', '晴天'), item('s2', '夜曲')])
  providerMocks.getPlayable.mockImplementation(async (music: MusicItem) => playableOf(music))
  providerMocks.getLyrics.mockResolvedValue(['[00:00]第一句\n[00:01]第二句'])
  providerMocks.getPersonalized.mockResolvedValue([item('r1', '推荐')])
  voiceMocks.resolveVoiceFile.mockResolvedValue('/tmp/voice.silk')
  messageMocks.replyMusicList.mockResolvedValue(undefined)
  messageMocks.replyVoiceFileOrAudio.mockResolvedValue(undefined)
})

describe('handleMusicMessage', () => {
  it('replies with usage help for empty search keywords', async () => {
    const { handleMusicMessage } = await loadController()
    const e = eventOf('#点歌')

    await handleMusicMessage(e, next)

    expect(providerMocks.search).not.toHaveBeenCalled()
    expect(messageMocks.replyPlainText).toHaveBeenCalledWith(e, expect.stringContaining('点歌说明'))
    expect(next).not.toHaveBeenCalled()
  })

  it('reports no songs instead of playing a fabricated result', async () => {
    providerMocks.search.mockResolvedValueOnce([])
    const { handleMusicMessage } = await loadController()
    const e = eventOf('#点歌 不存在')

    await handleMusicMessage(e, next)

    expect(messageMocks.replyText).toHaveBeenCalledWith(e, expect.stringContaining('没有找到歌曲'))
    expect(providerMocks.getPlayable).not.toHaveBeenCalled()
  })

  it('does not swallow out-of-range selections when a session exists', async () => {
    const { handleMusicMessage } = await loadController()
    await handleMusicMessage(eventOf('#点歌 晴天'), next)

    const outOfRange = eventOf('9')
    await handleMusicMessage(outOfRange, next)

    expect(next).toHaveBeenCalledTimes(1)
    expect(messageMocks.replyText).not.toHaveBeenCalledWith(outOfRange, expect.stringContaining('没有可选择的点歌列表'))
  })

  it('recalls every list page message when switching songs', async () => {
    const { handleMusicMessage } = await loadController()
    messageMocks.replyMusicList
      .mockResolvedValueOnce('list-1')
      .mockResolvedValueOnce('list-2')
      .mockResolvedValueOnce('list-3')

    await handleMusicMessage(eventOf('#多选点歌 晴天'), next)
    await handleMusicMessage(eventOf('#下一页'), next)
    expect(karinMocks.recallMsg).not.toHaveBeenCalled()

    await handleMusicMessage(eventOf('#点歌 夜曲'), next)

    const recalled = karinMocks.recallMsg.mock.calls.map(call => (call as unknown[])[1])
    expect(recalled).toEqual(['list-1', 'list-2'])
  })

  it('forwards full lyrics (plain + original LRC) without truncating', async () => {
    const { handleMusicMessage } = await loadController()
    const longLine = `[03:00]${'长'.repeat(2500)}`
    providerMocks.getLyrics.mockResolvedValueOnce([`[00:00]第一句\n${longLine}`, '[00:00]translation'])

    const e = eventOf('#点歌 晴天')
    await handleMusicMessage(e, next)

    const lyricsEvent = eventOf('#歌词')
    await handleMusicMessage(lyricsEvent, next)

    expect(lyricsEvent.bot.sendForwardMsg).toHaveBeenCalledTimes(1)
    const nodes = lyricsEvent.bot.sendForwardMsg.mock.calls[0]?.[1] as Array<{ message: Array<{ type: string, text?: string }> }>
    const text = nodes.map(node => node.message.map(el => el.text ?? '').join('')).join('\n')
    expect(text).toContain('长'.repeat(2500))
    expect(text).toContain('[00:00]translation')
  })

  it('sends normal voice as a SILK voice file', async () => {
    const { handleMusicMessage } = await loadController()
    await handleMusicMessage(eventOf('#点歌 晴天'), next)

    const voiceEvent = eventOf('#语音')
    await handleMusicMessage(voiceEvent, next)

    expect(messageMocks.replyPlainText).toHaveBeenCalledWith(voiceEvent, '开始上传[晴天-Hira]…', { recallMsg: 30 })
    expect(voiceMocks.resolveVoiceFile).toHaveBeenCalledWith(expect.objectContaining({ audioUrl: expect.stringContaining('s1') }))
    expect(messageMocks.replyVoiceFileOrAudio).toHaveBeenCalledWith(voiceEvent, expect.anything(), '/tmp/voice.silk')
  })

  it('uploads the original audio for high quality without transcoding', async () => {
    const { handleMusicMessage } = await loadController()
    await handleMusicMessage(eventOf('#点歌 晴天'), next)

    const voiceEvent = eventOf('#高清语音')
    await handleMusicMessage(voiceEvent, next)

    expect(voiceEvent.reply).toHaveBeenCalledWith(expect.objectContaining({ type: 'record', file: 'https://audio.example.test/s1.mp3' }))
    expect(voiceMocks.resolveVoiceFile).not.toHaveBeenCalled()
    // 高清直传成功后引用提示 PCQQ 兼容性
    expect(voiceEvent.reply).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ type: 'reply', messageId: 'sent-1' })]))
  })

  it('falls back to SILK when the high quality direct upload fails', async () => {
    const { handleMusicMessage } = await loadController()
    await handleMusicMessage(eventOf('#点歌 晴天'), next)

    voiceMocks.resolveVoiceFile.mockResolvedValueOnce('/tmp/fallback.silk')
    const voiceEvent = eventOf('#高清语音')
    voiceEvent.reply.mockRejectedValueOnce(new Error('unsupported record format'))

    await handleMusicMessage(voiceEvent, next)

    expect(voiceMocks.resolveVoiceFile).toHaveBeenCalledTimes(1)
    expect(voiceMocks.resolveVoiceFile).toHaveBeenCalledWith(expect.anything())
    expect(messageMocks.replyVoiceFileOrAudio).toHaveBeenCalledWith(voiceEvent, expect.anything(), '/tmp/fallback.silk')
  })

  it('sends voice for a quoted music share card', async () => {
    const { handleMusicMessage } = await loadController()
    const e = eventOf('#语音', {
      elements: [{ type: 'reply', messageId: 'quoted-1' }]
    })
    e.bot.getMsg.mockResolvedValue({
      elements: [{
        type: 'json',
        data: JSON.stringify({
          view: 'music',
          meta: { music: { title: '晴天', desc: '周杰伦', musicUrl: 'https://music.example.test/q.mp3' } }
        })
      }]
    })

    await handleMusicMessage(e, next)

    expect(providerMocks.getPlayable).not.toHaveBeenCalled()
    expect(voiceMocks.resolveVoiceFile).toHaveBeenCalledWith(
      expect.objectContaining({ audioUrl: 'https://music.example.test/q.mp3' })
    )
  })

  it('plays a random recommended song for 来首歌 instead of searching 歌', async () => {
    const { handleMusicMessage } = await loadController()
    const e = eventOf('#来首歌')

    await handleMusicMessage(e, next)

    expect(providerMocks.search).not.toHaveBeenCalled()
    expect(providerMocks.getPersonalized).toHaveBeenCalledWith('random', expect.objectContaining({ pageSize: expect.any(Number) }))
    expect(messageMocks.replyMusicPlayable).toHaveBeenCalled()
  })
})
