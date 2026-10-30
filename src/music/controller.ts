import path from 'node:path'

import karin, { common, segment, type CustomNodeElement, type Message } from 'node-karin'

import { isHiraAppEnabled } from '@/apps/runtime'
import { Config } from '@/config'
import { parseMusicCommand } from '@/music/commandParser'
import { BilibiliMusicProvider, createMusicProviders, extractBvFromText } from '@/music/providers'
import { formatArtists } from '@/music/providers/helpers'
import { extractQuotedMusicCard, findQuotedMessageId, readMessageElements, type QuotedMusicCard } from '@/music/quotedCard'
import { shouldDeferSelection } from '@/music/selection'
import { MusicSessionStore, type MusicSessionListTarget } from '@/music/session'
import type { MusicItem, MusicPersonalizedKind, MusicPlayable, MusicSource } from '@/music/types'
import { pcqqVoiceWarning, resolveVoiceFile, voiceUploadPlaceholder } from '@/music/voice'
import { downloadFile } from '@/runtime/downloader'
import { ensureTempDir, getTempRoot } from '@/runtime/temp'
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

/** 换歌/超时时整批撤回历史列表图,避免聊天区残留旧页码. */
const recallListMessages = async (targets: MusicSessionListTarget[]) => {
  for (const target of targets) {
    await recallListMessage(target)
  }
}

const store = new MusicSessionStore({
  getTtlMs: () => Config.music.sessionTtlSeconds * 1000,
  onExpire: (targets) => {
    void recallListMessages(targets)
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

const sourceName = (source: MusicSource): string => ({
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

const musicUsage = [
  '------点歌说明------',
  '格式：#点歌 歌名 / #多选点歌 歌名',
  '支持：QQ音乐、网易云、酷我、酷狗、哔哩哔哩',
  '示例：#QQ点歌 晴天、#多选网易点歌 青花',
  'QQ 个性化：#每日推荐、#个性电台、#我的收藏、#来首歌'
].join('\n')

const botAccount = (e: Message) => {
  const bot: unknown = e.bot
  if (!bot || typeof bot !== 'object' || !('account' in bot)) return undefined
  const account: unknown = bot.account
  if (!account || typeof account !== 'object') return undefined
  return account as { selfId?: string | number, name?: string }
}

const forwardIdentity = (e: Message) => {
  const account = botAccount(e)
  return {
    id: String(account?.selfId || e.selfId || ''),
    name: account?.name || '音乐'
  }
}

const canSendForward = (e: Message) => {
  const bot: unknown = e.bot
  return Boolean(bot && typeof bot === 'object' && 'sendForwardMsg' in bot && typeof bot.sendForwardMsg === 'function')
}

/** 去掉 LRC 时间轴, 只留可读歌词(云崽转发正文). */
export const stripLyricsTimeline = (lyrics: string) => lyrics
  .split(/\r?\n/)
  .map(line => line.match(/^\[.*\](.*)$/)?.[1] ?? line)
  .map(line => line.trim())
  .filter(Boolean)
  .join('\n')

const lyricsForwardNodes = (e: Message, item: MusicItem, blocks: string[]) => {
  const identity = forwardIdentity(e)
  const header = `${item.title}-${formatArtists(item.artists)}`
  const nodes: CustomNodeElement[] = []

  for (const block of blocks) {
    const plain = stripLyricsTimeline(block)
    if (plain && plain !== block.trim()) {
      nodes.push(...common.makeForward([segment.text(`---${header}---\n${plain}`)], identity.id, identity.name))
    }
    // 原始 LRC 也完整保留, 交给用户自己取时间轴.
    nodes.push(...common.makeForward([segment.text(`---${header}---\n${block}`)], identity.id, identity.name))
  }

  return nodes
}

/**
 * 歌词转发: 完整歌词 + 去掉时间轴的正文(网易云带翻译)各占一层, 不截断.
 * 适配器不支持转发时回纯文本, 仍然不截断.
 */
const replyLyrics = async (e: Message, item: MusicItem, blocks: string[]) => {
  const nodes = lyricsForwardNodes(e, item, blocks)
  if (canSendForward(e)) {
    try {
      await e.bot.sendForwardMsg(e.contact, nodes, {
        source: '音乐歌词',
        summary: `${item.title} 歌词`,
        prompt: `${item.title} 歌词`,
        news: [{ text: '点击查看完整歌词' }]
      })
      return
    } catch {
      // 频道/部分适配器不支持转发, 回退纯文本.
    }
  }

  await replyPlainText(e, blocks.map(block => `---${item.title}-${formatArtists(item.artists)}---\n${block}`).join('\n\n'))
}

const playableOfCard = (card: QuotedMusicCard): MusicPlayable => ({
  item: {
    id: card.musicUrl,
    source: 'qq',
    title: card.title,
    artists: card.desc ? [card.desc] : [],
    pageUrl: card.jumpUrl || card.musicUrl
  },
  audioUrl: card.musicUrl
})

const readQuotedMusicCard = async (e: Message) => {
  const replyId = findQuotedMessageId(e.elements)
  if (!replyId) return undefined
  try {
    return extractQuotedMusicCard(readMessageElements(await e.bot.getMsg(e.contact, replyId)))
  } catch {
    // 被撤回/跨群引用/适配器不支持时按"没有引用卡片"处理.
    return undefined
  }
}

/**
 * 发送语音: 普通=真语音条(SILK), 高清=原音质直传, 直传失败降级 SILK.
 * 高清直传成功才提示 PCQQ 兼容性.
 */
const sendPlayableVoice = async (e: Message, playable: MusicPlayable, highQuality = false) => {
  try {
    // 占位消息 30 秒后自动撤回, 不长期占聊天区.
    await replyPlainText(e, voiceUploadPlaceholder(playable), { recallMsg: 30 })
  } catch {
    // 占位发送失败忽略, 继续走语音链.
  }

  if (highQuality) {
    // 云崽 transcoding=false: 原音质直传, 不走转码.
    let directMessageId: string | undefined
    try {
      const result = await e.reply(segment.record(playable.audioUrl))
      directMessageId = result?.messageId
    } catch {
      directMessageId = undefined
    }

    if (directMessageId) {
      try {
        await e.reply([segment.reply(directMessageId), segment.text(pcqqVoiceWarning(playable))])
      } catch {
        await replyPlainText(e, pcqqVoiceWarning(playable))
      }
      return
    }
    // 直传失败(音源格式不被语音端接受)时降级 SILK 真语音条.
  }

  let voiceFile: string | undefined
  try {
    voiceFile = await resolveVoiceFile(playable)
  } catch {
    voiceFile = undefined
  }
  await replyVoiceFileOrAudio(e, playable, voiceFile)
}

const musicFileExtension = (url: string) => {
  try {
    const ext = path.extname(new URL(url).pathname).replace(/^\./, '')
    return /^[a-zA-Z0-9]{2,5}$/.test(ext) ? ext : 'mp3'
  } catch {
    return 'mp3'
  }
}

/** 引用卡片下载音乐: 落盘后用 uploadFile 发群文件, 场景不支持时回下载链接. */
const downloadPlayableAudio = async (e: Message, playable: MusicPlayable) => {
  const dir = ensureTempDir(getTempRoot(), 'music-download')
  const filename = `${playable.item.title}-${formatArtists(playable.item.artists)}.${musicFileExtension(playable.audioUrl)}`
    .replace(/[\\/:*?"<>|]/g, '_')
  const output = path.join(dir, `${Date.now()}-${filename}`)
  await downloadFile({ url: playable.audioUrl, output })

  if (['group', 'friend'].includes(e.contact.scene) && typeof e.bot.uploadFile === 'function') {
    await e.bot.uploadFile(e.contact, output, filename)
    return
  }
  await replyPlainText(e, `${filename}\n${playable.audioUrl}`)
}

const replyNoSongs = async (e: Message, personalized = false) => {
  await replyText(e, personalized ? '获取推荐歌曲失败，请重试！' : '没有找到歌曲！')
}

export const handleMusicMessage = async (e: Message, next?: () => unknown) => {
  if (!isHiraAppEnabled()) return next?.()
  if (!Config.music.enabled) return next?.()

  const command = parseMusicCommand(e.msg)
  if (command.type === 'none') return next?.()

  try {
    if (command.type === 'search') {
      if (!command.keyword) {
        await replyPlainText(e, musicUsage)
        return true
      }

      const source = command.source ?? Config.music.defaultSource
      const page = 1
      const items = await getProvider(source).search(command.keyword, page, Config.music.pageSize)
      if (items.length === 0) {
        await replyNoSongs(e)
        return true
      }

      const key = sessionKey(e)
      // 换歌自动撤上一条列表(含翻页产生的所有列表图),避免聊天区留垃圾图
      await recallListMessages(store.takeListMessages(key))
      store.set(key, items, { keyword: command.keyword, source, page })

      if (command.listMode || Config.music.listModeDefault) {
        const listMessageId = await replyMusicList(e, items, page, { startIndex: 1 })
        if (listMessageId) store.addListMessage(key, { contact: e.contact, selfId: e.selfId, messageId: listMessageId })
        return true
      }

      const first = store.select(key, 1)
      if (!first) {
        await replyNoSongs(e)
        return true
      }

      const playable = await getProvider(first.source).getPlayable(first)
      await replyMusicPlayable(e, playable)
      return true
    }

    if (command.type === 'select') {
      if (shouldDeferSelection(e.msg, Boolean(store.get(sessionKey(e))))) return next?.()

      const key = sessionKey(e)
      const session = store.get(key)
      if (!session) {
        await replyText(e, '当前没有可选择的点歌列表，先发送 #点歌 歌名')
        return true
      }

      const item = selectItem(e, command.index)
      if (!item) {
        // 越界序号不是本插件的消息, 静默放行给其它插件, 不吞也不误导.
        return next?.()
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
      // 个性化歌单(收藏等)的翻页走各自接口, 不能拿 "我的收藏" 当搜索词.
      const personalizedKind: MusicPersonalizedKind | undefined = session.meta.source === 'qq' && ['dailyRecommend', 'radio', 'favorites', 'random'].includes(session.meta.keyword)
        ? session.meta.keyword as MusicPersonalizedKind
        : undefined
      const provider = getProvider(session.meta.source)
      const items = personalizedKind && typeof provider.getPersonalized === 'function'
        ? await provider.getPersonalized(personalizedKind, {
          page,
          pageSize: personalizedKind === 'dailyRecommend' ? 30 : Config.music.pageSize
        })
        : await provider.search(session.meta.keyword, page, Config.music.pageSize)
      if (items.length === 0) {
        await replyNoSongs(e)
        return true
      }

      // 追加而非覆盖:序号跨页连续,下一页续期 TTL
      const appended = store.appendPage(key, items, page)
      const startIndex = appended?.startIndex ?? session.startIndex + session.items.length
      const listMessageId = await replyMusicList(e, items, page, { startIndex })
      if (listMessageId) store.addListMessage(key, { contact: e.contact, selfId: e.selfId, messageId: listMessageId })
      return true
    }

    if (command.type === 'lyrics') {
      const item = selectItem(e, command.index)
      if (!item) {
        await replyText(e, '当前没有可查询歌词的歌曲')
        return true
      }
      const lyrics = await getProvider(item.source).getLyrics?.(item)
      const blocks = (Array.isArray(lyrics) ? lyrics : [lyrics])
        .filter((value): value is string => Boolean(value?.trim()))
      if (blocks.length === 0) {
        await replyText(e, '当前音乐源暂未返回歌词')
        return true
      }
      await replyLyrics(e, item, blocks)
      return true
    }

    if (command.type === 'voice' || command.type === 'download') {
      if (command.type === 'voice' && !Config.music.voiceEnabled) {
        await replyText(e, '语音点歌当前未开启')
        return true
      }

      const card = await readQuotedMusicCard(e)
      if (card) {
        const playable = playableOfCard(card)
        if (command.type === 'download') {
          await downloadPlayableAudio(e, playable)
        } else {
          await sendPlayableVoice(e, playable, command.highQuality === true)
        }
        return true
      }

      if (command.type === 'download') {
        await replyText(e, '请引用一条音乐分享卡片后再发送 #下载音乐')
        return true
      }

      const item = selectItem(e, command.index)
      if (!item) {
        await replyText(e, '当前没有可发送语音的歌曲')
        return true
      }
      await sendPlayableVoice(e, await getProvider(item.source).getPlayable(item), Boolean(command.highQuality || Config.music.highQuality))
      return true
    }

    if (command.type === 'bilibiliLink') {
      const provider = getProvider('bilibili') as BilibiliMusicProvider
      const item = await provider.fromLink(await expandBilibiliLink(command.url))
      await replyMusicPlayable(e, await provider.getPlayable(item))
      return true
    }

    if (command.type === 'random' || command.type === 'radio' || command.type === 'favorites' || command.type === 'dailyRecommend') {
      const provider = getProvider('qq')
      if (typeof provider.getPersonalized !== 'function') {
        await replyText(e, '当前音乐源不支持个性化推荐，请配置 QQ 音乐 Cookie 后重试')
        return true
      }

      const pageSize = command.type === 'dailyRecommend'
        ? 30
        : command.type === 'radio'
          ? 5
          : Config.music.pageSize

      if (command.type !== 'random') await replyPlainText(e, '请稍候…')
      const items = await provider.getPersonalized(command.type, {
        page: command.type === 'favorites' ? command.page ?? 1 : 1,
        pageSize
      })
      if (items.length === 0) {
        await replyNoSongs(e, true)
        return true
      }

      if (command.type === 'random') {
        await replyMusicPlayable(e, await provider.getPlayable(items[0]))
        return true
      }

      const key = sessionKey(e)
      await recallListMessages(store.takeListMessages(key))
      const page = command.type === 'favorites' ? command.page ?? 1 : 1
      store.set(key, items, { keyword: command.type, source: 'qq', page })

      if (command.type === 'radio') {
        // 电台只推歌, 不进入列表选择; 取首条直接播放.
        await replyMusicPlayable(e, await provider.getPlayable(items[0]))
        return true
      }

      const listMessageId = await replyMusicList(e, items, page, { startIndex: 1 })
      if (listMessageId) store.addListMessage(key, { contact: e.contact, selfId: e.selfId, messageId: listMessageId })
      return true
    }
  } catch (error) {
    await replyText(e, error instanceof Error ? error.message : String(error))
    return true
  }
}
