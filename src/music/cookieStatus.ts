import type { MusicConfig } from '@/types/config'

import { NeteaseProvider } from './providers/netease'
import { QQProvider, normalizeQQCookieStatus } from './providers/qq'

export { normalizeQQCookieStatus }

export type CookieCheckResult = {
  ok: boolean
  message: string
}

type StatusOptions = {
  cookies: MusicConfig['cookies']
  neteaseBaseUrl?: string
  qqTempApi?: string
  checkNetease?: () => Promise<CookieCheckResult>
  checkQQ?: () => Promise<CookieCheckResult>
}

const configuredStatus = (cookie: string) => cookie.trim() ? '已配置' : '未配置'

const checkedStatus = async (cookie: string, check: () => Promise<CookieCheckResult>) => {
  if (!cookie.trim()) return '未配置'

  try {
    const result = await check()
    return `${result.ok ? '在线' : '失效'}（${result.message}）`
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return `检查失败（${message}）`
  }
}

export const buildMusicCookieStatusLines = async (options: StatusOptions) => {
  const { cookies } = options
  const checkNetease = options.checkNetease ?? (() => new NeteaseProvider({
    baseUrl: options.neteaseBaseUrl ?? 'https://neteasecloudmusicapi.vercel.app',
    cookie: cookies.netease
  }).checkCookie())
  const checkQQ = options.checkQQ ?? (() => new QQProvider({
    tempApi: options.qqTempApi ?? '',
    cookie: cookies.qq
  }).checkCookie())

  const [netease, qq] = await Promise.all([
    checkedStatus(cookies.netease, checkNetease),
    checkedStatus(cookies.qq, checkQQ)
  ])

  return [
    '音乐 Cookie 状态',
    `网易云：${netease}`,
    `QQ音乐：${qq}`,
    `酷我：${configuredStatus(cookies.kuwo)}`,
    `酷狗：${configuredStatus(cookies.kugou)}`,
    `哔哩哔哩：${configuredStatus(cookies.bilibili)}`
  ]
}

export const getMusicCookieStatusLines = (music: MusicConfig) => buildMusicCookieStatusLines({
  cookies: music.cookies,
  neteaseBaseUrl: music.api.neteaseBaseUrl,
  qqTempApi: music.api.qqTempApi
})
