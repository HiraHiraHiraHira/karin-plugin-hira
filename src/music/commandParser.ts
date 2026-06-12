import type { MusicCommand, MusicSource } from './types'

const sourceAliases: Array<[RegExp, MusicSource]> = [
  [/^(?:网易云?|163)$/i, 'netease'],
  [/^(?:QQ|扣扣|qqmusic)$/i, 'qq'],
  [/^酷我$/i, 'kuwo'],
  [/^酷狗$/i, 'kugou'],
  [/^(?:哔哩哔哩|哔哩|B站|bilibili)$/i, 'bilibili']
]

const sourceWords = ['网易云', '网易', 'QQ', 'qq', '扣扣', '酷我', '酷狗', '哔哩哔哩', '哔哩', 'B站', 'bilibili']
const actionWords = ['点歌', '点播音乐', '点播', '播放', '放一首', '放首', '来一首', '来首']
const bilibiliUrlPattern = /https?:\/\/[^\s"'<>]*(?:bilibili\.com|b23\.tv|bili2233\.cn)[^\s"'<>]*/i
const musicCookieCommandPattern = /^#?(?:(?:点歌|音乐)(?:ck|cookie)(?:检查|状态)|提交(?:音乐|点歌)(?:ck|cookie)(?:\s|$))/i

const normalizeSource = (word?: string): MusicSource | undefined => {
  if (!word) return undefined
  const normalized = word.trim()
  return sourceAliases.find(([pattern]) => pattern.test(normalized))?.[1]
}

const stripHash = (msg: string) => msg.trim().replace(/^#/, '').trim()

export const parseMusicCommand = (message: string): MusicCommand => {
  const msg = message.trim()
  if (!msg) return { type: 'none' }

  const bilibiliLink = msg.match(/^#?音乐\s+(.+)$/)?.[1]?.match(bilibiliUrlPattern)?.[0]
  if (bilibiliLink) return { type: 'bilibiliLink', url: bilibiliLink }

  const select = msg.match(/^(?:#?(?:听|播放))?([1-9]\d*)$/)
  if (select) return { type: 'select', index: Number(select[1]) }

  if (/^#?下一页$/.test(msg)) return { type: 'nextPage' }

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

  const clean = stripHash(msg)
  if (musicCookieCommandPattern.test(clean)) return { type: 'none' }

  const sourcePattern = sourceWords.join('|')
  const actionPattern = actionWords.join('|')
  const search = clean.match(new RegExp(`^(多选)?(${sourcePattern})?(多选)?(?:${actionPattern})\\s*(\\S[\\s\\S]*)$`, 'i'))
  if (!search) return { type: 'none' }

  const keyword = search[4]?.trim()
  if (!keyword) return { type: 'none' }

  return {
    type: 'search',
    keyword,
    source: normalizeSource(search[2]),
    listMode: Boolean(search[1] || search[3])
  }
}
