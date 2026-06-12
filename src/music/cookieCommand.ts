import type { MusicSource } from './types'

type CookieMusicSource = Extract<MusicSource, 'netease' | 'qq' | 'kuwo' | 'kugou' | 'bilibili'>

export type MusicCookieCommand =
  | { type: 'submit', source: CookieMusicSource, cookie: string }
  | { type: 'status' }
  | { type: 'none' }

const sourceAliases: Array<[RegExp, CookieMusicSource]> = [
  [/^(?:网易云?|163)$/i, 'netease'],
  [/^(?:QQ|扣扣|qqmusic)$/i, 'qq'],
  [/^酷我$/i, 'kuwo'],
  [/^酷狗$/i, 'kugou'],
  [/^(?:哔哩哔哩|哔哩|B站|bilibili)$/i, 'bilibili']
]

const parseSource = (value: string) => sourceAliases.find(([pattern]) => pattern.test(value))?.[1]

export const parseMusicCookieCommand = (message: string): MusicCookieCommand => {
  const clean = message.trim()
  if (/^#?(?:点歌|音乐)(?:ck|cookie)(?:检查|状态)$/i.test(clean)) return { type: 'status' }

  const submit = clean.match(/^#?提交(?:音乐|点歌)(?:ck|cookie)\s+(\S+)\s+([\s\S]+)$/i)
  if (!submit) return { type: 'none' }

  const source = parseSource(submit[1])
  const cookie = submit[2]?.trim()
  if (!source || !cookie) return { type: 'none' }

  return { type: 'submit', source, cookie }
}

const maskValue = (value: string) => {
  if (value.length <= 6) return '*'.repeat(value.length)
  return `${value.slice(0, 3)}...${value.slice(-3)}`
}

export const maskCookie = (cookie: string) => {
  if (!cookie.trim()) return '未配置'

  return cookie
    .split(';')
    .map(part => part.trim())
    .filter(Boolean)
    .map(part => {
      const [key, ...rest] = part.split('=')
      const value = rest.join('=')
      if (!value) return key
      return `${key}=${maskValue(value)}`
    })
    .join('; ')
}
