import type { MusicCommand, MusicSource } from './types'

const sourceAliases: Array<[RegExp, MusicSource]> = [
  [/^(?:网易云?|163)$/i, 'netease'],
  [/^(?:QQ|扣扣|qqmusic)$/i, 'qq'],
  [/^酷我$/i, 'kuwo'],
  [/^酷狗$/i, 'kugou'],
  [/^(?:哔哩哔哩|哔哩|B站|bilibili)$/i, 'bilibili']
]

const sourceWords = ['网易云?', 'QQ', 'qq', '扣扣', '酷我', '酷狗', '哔哩哔哩', '哔哩', 'B站', 'bilibili']
const actionWords = ['点歌', '点播音乐', '点播', '播放', '放一首', '放首', '来一首', '来首']
const bilibiliUrlPattern = /https?:\/\/[^\s"'<>]*(?:bilibili\.com|b23\.tv|bili2233\.cn)[^\s"'<>]*/i
const musicCookieCommandPattern = /^#?(?:(?:点歌|音乐)(?:ck|cookie)(?:检查|状态)|提交(?:音乐|点歌)(?:ck|cookie)(?:\s|$))/i

const normalizeSource = (word?: string): MusicSource | undefined => {
  if (!word) return undefined
  const normalized = word.trim()
  return sourceAliases.find(([pattern]) => pattern.test(normalized))?.[1]
}

const stripHash = (msg: string) => msg.trim().replace(/^#/, '').trim()

/** 允许在命令前写音乐源, 与搜索命令保持一致的写法(`#QQ每日推荐`). */
const withOptionalSource = (body: string) =>
  new RegExp(`^(?:多选)?(?:${sourceWords.join('|')})?(?:多选)?(?:${body})$`, 'i')

const personalizedPattern = withOptionalSource('(每日推荐|每日30首|日推|个性电台|我的收藏|我喜欢的歌)\\s*(\\d+)?')

export const parseMusicCommand = (message: string): MusicCommand => {
  const msg = message.trim()
  if (!msg) return { type: 'none' }

  const bilibiliLink = msg.match(/^#?音乐\s+(.+)$/)?.[1]?.match(bilibiliUrlPattern)?.[0]
  if (bilibiliLink) return { type: 'bilibiliLink', url: bilibiliLink }

  const select = msg.match(/^(?:#?(?:听|播放))?([1-9]\d*)$/)
  if (select) return { type: 'select', index: Number(select[1]) }

  if (/^#?下一页$/.test(msg)) return { type: 'nextPage' }

  // 小飞的 #歌词 / #语音 允许省略序号: 取上次选中(没有则取首项).
  const lyrics = msg.match(/^#?歌词\s*([1-9]\d*)?$/)
  if (lyrics) {
    return lyrics[1] ? { type: 'lyrics', index: Number(lyrics[1]) } : { type: 'lyrics' }
  }

  const voice = msg.match(/^#?(高清)?语音\s*([1-9]\d*)?$/)
  if (voice) {
    return {
      type: 'voice',
      ...(voice[2] ? { index: Number(voice[2]) } : {}),
      ...(voice[1] ? { highQuality: true } : {})
    }
  }

  if (/^#?下载音乐\s*(?:[1-9]\d*)?$/.test(msg)) return { type: 'download' }

  const clean = stripHash(msg)
  if (musicCookieCommandPattern.test(clean)) return { type: 'none' }

  const personalized = clean.match(personalizedPattern)
  if (personalized) {
    const word = personalized[1]
    const page = personalized[2] ? Number(personalized[2]) : undefined
    if (word === '个性电台') return { type: 'radio' }
    if (word === '我的收藏' || word === '我喜欢的歌') {
      return { type: 'favorites', ...(page ? { page } : {}) }
    }
    return { type: 'dailyRecommend' }
  }

  // `来首歌` / `放首歌` 会被搜索正则当成关键词 "歌", 必须先拦成随机推歌.
  if (/^(?:来一首|来首|放一首|放首)歌$/.test(clean)) return { type: 'random' }

  const sourcePattern = sourceWords.join('|')
  const actionPattern = actionWords.join('|')
  // 关键词允许为空: `#点歌` 空关键词由控制器回用法说明(小飞原始行为).
  const search = clean.match(new RegExp(`^(多选)?(${sourcePattern})?(多选)?(?:${actionPattern})\\s*([\\s\\S]*)$`, 'i'))
  if (!search) return { type: 'none' }

  return {
    type: 'search',
    keyword: search[4]?.trim() ?? '',
    source: normalizeSource(search[2]),
    listMode: Boolean(search[1] || search[3])
  }
}
