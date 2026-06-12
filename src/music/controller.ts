import type { Message } from 'node-karin'

import { Config } from '@/config'
import { parseMusicCommand } from '@/music/commandParser'
import { BilibiliMusicProvider, createMusicProviders } from '@/music/providers'
import { shouldDeferSelection } from '@/music/selection'
import { MusicSessionStore } from '@/music/session'
import type { MusicItem, MusicSource } from '@/music/types'
import { transcodePlayableToVoice } from '@/music/voice'
import { replyMusicList, replyMusicPlayable, replyText, replyVoiceFileOrAudio } from '@/services/message'

const store = new MusicSessionStore({ ttlMs: Config.music.sessionTtlSeconds * 1000 })

const sessionKey = (e: Message) => {
  const groupPeer = e.isGroup ? e.contact.peer : ''
  return `${e.selfId}:${groupPeer || e.userId}`
}

const providers = () => createMusicProviders()

const sourceName = (source: MusicSource) => ({
  netease: '网易云',
  qq: 'QQ音乐',
  kuwo: '酷我',
  kugou: '酷狗',
  bilibili: '哔哩哔哩'
})[source]

const getProvider = (source: MusicSource) => {
  const provider = providers().get(source)
  if (!provider) throw new Error(`未启用音乐源：${sourceName(source)}`)
  return provider
}

const selectItem = (e: Message, index?: number): MusicItem | undefined => {
  const key = sessionKey(e)
  if (index) return store.select(key, index)
  return store.getLastSelected(key) ?? store.select(key, 1)
}

export const handleMusicMessage = async (e: Message, next?: () => unknown) => {
  if (!Config.music.enabled) return next?.()

  const command = parseMusicCommand(e.msg)
  if (command.type === 'none') return next?.()

  try {
    if (command.type === 'search') {
      const source = command.source ?? Config.music.defaultSource
      const page = 1
      const items = await getProvider(source).search(command.keyword, page, Config.music.pageSize)
      store.set(sessionKey(e), items, { keyword: command.keyword, source, page })

      if (command.listMode || Config.music.listModeDefault) {
        await replyMusicList(e, items, page)
        return true
      }

      const first = store.select(sessionKey(e), 1)
      if (!first) {
        await replyText(e, '没有搜到相关歌曲')
        return true
      }

      const playable = await getProvider(first.source).getPlayable(first)
      await replyMusicPlayable(e, playable)
      return true
    }

    if (command.type === 'select') {
      if (shouldDeferSelection(e.msg, Boolean(store.get(sessionKey(e))))) return next?.()

      const item = selectItem(e, command.index)
      if (!item) {
        await replyText(e, '当前没有可选择的点歌列表，先发送 #点歌 歌名')
        return true
      }
      await replyMusicPlayable(e, await getProvider(item.source).getPlayable(item))
      return true
    }

    if (command.type === 'nextPage') {
      const session = store.get(sessionKey(e))
      if (!session) {
        await replyText(e, '当前没有点歌列表，先发送 #点歌 歌名')
        return true
      }

      const page = session.meta.page + 1
      const items = await getProvider(session.meta.source).search(session.meta.keyword, page, Config.music.pageSize)
      store.set(sessionKey(e), items, { ...session.meta, page })
      await replyMusicList(e, items, page)
      return true
    }

    if (command.type === 'lyrics') {
      const item = selectItem(e, command.index)
      if (!item) {
        await replyText(e, '当前没有可查询歌词的歌曲')
        return true
      }
      const lyrics = await getProvider(item.source).getLyrics?.(item)
      await replyText(e, lyrics?.trim() ? lyrics.slice(0, 1800) : '当前音乐源暂未返回歌词')
      return true
    }

    if (command.type === 'voice') {
      if (!Config.music.voiceEnabled) {
        await replyText(e, '语音点歌当前未开启')
        return true
      }

      const item = selectItem(e, command.index)
      if (!item) {
        await replyText(e, '当前没有可发送语音的歌曲')
        return true
      }
      const playable = await getProvider(item.source).getPlayable(item)
      try {
        await replyVoiceFileOrAudio(e, playable, await transcodePlayableToVoice(playable))
      } catch {
        await replyVoiceFileOrAudio(e, playable)
      }
      return true
    }

    if (command.type === 'bilibiliLink') {
      const provider = getProvider('bilibili') as BilibiliMusicProvider
      const item = await provider.fromLink(command.url)
      await replyMusicPlayable(e, await provider.getPlayable(item))
      return true
    }
  } catch (error) {
    await replyText(e, error instanceof Error ? error.message : String(error))
    return true
  }
}
