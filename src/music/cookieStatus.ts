import type { MusicConfig } from '@/types/config'

import { NeteaseProvider } from './providers/netease'
import { QQProvider, normalizeQQCookieStatus } from './providers/qq'

export { normalizeQQCookieStatus }

export type CookieCheckResult = {
  ok: boolean
  message: string
  /** 账号是否 VIP; 平台不返回时为 undefined */
  vip?: boolean
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
    const vip = result.vip === undefined ? '' : `，${result.vip ? 'VIP' : '非VIP'}`
    return `${result.ok ? '在线' : '失效'}（${result.message}${vip}）`
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

/**
 * 提交前校验: 网易云/QQ 音乐会真实登录一次以回显账号与 VIP;
 * 其它平台没有稳定的校验接口, 直接保存(与云崽一致).
 */
export const validateMusicCookie = async (
  options: StatusOptions,
  source: keyof MusicConfig['cookies'],
  cookie: string
): Promise<{ checkable: boolean, ok: boolean, message?: string, vip?: boolean }> => {
  if (source === 'netease') {
    const result = await new NeteaseProvider({
      baseUrl: options.neteaseBaseUrl ?? 'https://neteasecloudmusicapi.vercel.app',
      cookie
    }).checkCookie()
    return { checkable: true, ok: result.ok, message: result.message, vip: result.vip }
  }
  if (source === 'qq') {
    const result = await new QQProvider({ tempApi: options.qqTempApi ?? '', cookie }).checkCookie()
    return { checkable: true, ok: result.ok, message: result.message, vip: result.vip }
  }
  return { checkable: false, ok: true }
}
