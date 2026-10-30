import type { MusicSource } from './types'

type CookieMusicSource = Extract<MusicSource, 'netease' | 'qq' | 'kuwo' | 'kugou' | 'bilibili'>

export type MusicCookieCommand =
  | { type: 'submit', source: CookieMusicSource, cookie: string }
  | { type: 'help' }
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

/**
 * 老用法只有一段 Cookie(`#提交音乐ckMUSIC_U=...`), 按 Cookie 里的关键字段自动判平台.
 * 两段式(显式写平台)仍然支持, 且优先级更高.
 */
export const detectMusicCookieSource = (cookie: string): CookieMusicSource | undefined => {
  if (/(?:^|[;\s])MUSIC_U\s*=/i.test(cookie)) return 'netease'
  if (/(?:wxunionid|wxuin|psrf_qqunionid|psrf_qqopenid|qqmusic_key|qm_keyst)\s*=/i.test(cookie)) return 'qq'
  return undefined
}

export const musicCookieHelp = [
  '格式：#提交音乐ck + Cookie（自动识别网易云/QQ音乐）',
  '也支持两段式：#提交音乐ck 平台 Cookie',
  '',
  '--- QQ音乐 ck 获取 ---',
  '请前往 https://y.qq.com/ 获取，必须包含：uin/wxuin、qm_keyst（qqmusic_key）、psrf_qqunionid 或 wxunionid 等字段。',
  '--- 网易云音乐 ck 获取 ---',
  '请前往 https://music.163.com/ 获取，必须包含：MUSIC_U=...（HttpOnly，需抓包或浏览器开发者工具获取）。'
].join('\n')

export const parseMusicCookieCommand = (message: string): MusicCookieCommand => {
  const clean = message.trim()
  if (/^#?(?:点歌|音乐)(?:ck|cookie)(?:检查|状态)$/i.test(clean)) return { type: 'status' }

  const submit = clean.match(/^#?提交(?:音乐|点歌)(?:ck|cookie)\s*([\s\S]*)$/i)
  if (!submit) return { type: 'none' }

  // 从浏览器复制时常带引号, 顺带去掉.
  const body = submit[1].replace(/['"]/g, '').trim()
  if (!body) return { type: 'help' }

  // 两段式: 平台 + Cookie
  const explicit = body.match(/^(\S+)\s+([\s\S]+)$/)
  const explicitSource = explicit ? parseSource(explicit[1]) : undefined
  if (explicit && explicitSource) {
    return { type: 'submit', source: explicitSource, cookie: explicit[2].trim() }
  }

  const source = detectMusicCookieSource(body)
  if (!source) return { type: 'help' }

  return { type: 'submit', source, cookie: body }
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
