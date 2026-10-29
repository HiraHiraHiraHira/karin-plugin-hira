import karin, { segment, type Message } from 'node-karin'

import { isHiraAppEnabled } from '@/apps/runtime'
import { Config } from '@/config'
import { parseMusicCommand } from '@/music/commandParser'
import { BilibiliMusicProvider, createMusicProviders, extractBvFromText } from '@/music/providers'
import { shouldDeferSelection } from '@/music/selection'
import { MusicSessionStore, type MusicSessionListTarget } from '@/music/session'
import type { MusicItem, MusicSource } from '@/music/types'
import { isAmrAudioUrl, pcqqVoiceWarning, resolveVoiceFile, voiceUploadPlaceholder } from '@/music/voice'
import { replyMusicList, replyMusicPlayable, replyPlainText, replyText, replyVoiceFileOrAudio } from '@/services/message'
import { resolveResolverRedirectUrl } from '@/services/resolverHttp'

/** 撤回一条列表消息,失败静默(过期/无权限/已被撤都属正常). */
const recallListMessage = async (target: MusicSessionListTarget) => {
  try {
    await karin.getBot(target.selfId)?.recallMsg(target.contact, target.messageId)
  } catch {
    // 忽略撤回失败,会话清理本身不受影响
  }
}

const store = new MusicSessionStore({
  getTtlMs: () => Config.music.sessionTtlSeconds * 1000,
  onExpire: (target) => {
    void recallListMessage(target)
  }
})

/**
 * 启动会话清理定时器并返回它(便于测试或热重载时清除).
 * unref 让定时器不阻止进程退出,否则插件卸载后进程仍会因它驻留.
 */
export const startSessionSweeper = (store: MusicSessionStore, intervalMs = 60_000) => {
  const timer = setInterval(() => {
    store.sweep()
  }, intervalMs)
  timer.unref?.()
  return timer
}

// 模块加载即启动:过期会话需要在无人交互时也按时清理与撤回
startSessionSweeper(store)

/** B站短链（b23.tv/bili2233.cn）和带追踪参数的链接先还原成含 BV 号的落地页。 */
const expandBilibiliLink = async (url: string) => {
  if (extractBvFromText(url)) {
    // 落地页里的 BV 号即可，短链还原还会引入一次网络请求。
    return url
  }
  try {
    return await resolveResolverRedirectUrl(url)
  } catch {
    return url
  }
}

/** 会话按人隔离:群聊 group_群_用户_bot,私聊 friend_用户_bot,保留 selfId 区分多 Bot. */
const sessionKey = (e: Message) => {
  const scope = e.isGroup ? `group_${e.contact.peer}` : 'friend'
  const user = e.userId || e.contact.peer
  return `${scope}_${user}_${e.selfId}`
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
  if (!isHiraAppEnabled()) return next?.()
  if (!Config.music.enabled) return next?.()

  const command = parseMusicCommand(e.msg)
  if (command.type === 'none') return next?.()

  try {
    if (command.type === 'search') {
      const source = command.source ?? Config.music.defaultSource
      const page = 1
      const items = await getProvider(source).search(command.keyword, page, Config.music.pageSize)
      const key = sessionKey(e)
      // 换歌自动撤上一条列表,避免聊天区留垃圾图;撤回失败属正常,不阻塞新列表
      const prev = store.takeListMessage(key)
      if (prev) void recallListMessage(prev)
      store.set(key, items, { keyword: command.keyword, source, page })

      if (command.listMode || Config.music.listModeDefault) {
        const listMessageId = await replyMusicList(e, items, page, { startIndex: 1 })
        if (listMessageId) store.setListMessage(key, { contact: e.contact, selfId: e.selfId, messageId: listMessageId })
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
      const key = sessionKey(e)
      const session = store.get(key)
      if (!session) {
        await replyText(e, '当前没有点歌列表，先发送 #点歌 歌名')
        return true
      }

      const page = session.meta.page + 1
      const items = await getProvider(session.meta.source).search(session.meta.keyword, page, Config.music.pageSize)
      // 追加而非覆盖:序号跨页连续,下一页续期 TTL
      const appended = store.appendPage(key, items, page)
      const startIndex = appended?.startIndex ?? session.startIndex + session.items.length
      const listMessageId = await replyMusicList(e, items, page, { startIndex })
      if (listMessageId) store.setListMessage(key, { contact: e.contact, selfId: e.selfId, messageId: listMessageId })
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
      const highQuality = Boolean(command.highQuality || Config.music.highQuality)
      // 先占位: 上传前回“开始上传[歌名-歌手]…”, 失败也不阻塞后续发送.
      try {
        await replyPlainText(e, voiceUploadPlaceholder(playable))
      } catch {
        // 占位发送失败忽略, 继续走语音链.
      }
      let voiceFile: string | undefined
      try {
        voiceFile = await resolveVoiceFile(playable, { highQuality })
      } catch {
        voiceFile = undefined
      }
      const sentMessageId = await replyVoiceFileOrAudio(e, playable, voiceFile)
      // 仅在 amr 直传成功时提示 PCQQ 兼容性;转码成 ogg 的源两端都能播,不需要警告.
      // voiceFile 为 undefined 也可能是转码失败,不能用它反推是否直传.
      const directAmrUpload = highQuality && isAmrAudioUrl(playable.audioUrl)
      if (directAmrUpload && sentMessageId) {
        try {
          await e.reply([segment.reply(sentMessageId), segment.text(pcqqVoiceWarning(playable))])
        } catch {
          await replyPlainText(e, pcqqVoiceWarning(playable))
        }
      }
      return true
    }

    if (command.type === 'bilibiliLink') {
      const provider = getProvider('bilibili') as BilibiliMusicProvider
      const item = await provider.fromLink(await expandBilibiliLink(command.url))
      await replyMusicPlayable(e, await provider.getPlayable(item))
      return true
    }
  } catch (error) {
    await replyText(e, error instanceof Error ? error.message : String(error))
    return true
  }
}
