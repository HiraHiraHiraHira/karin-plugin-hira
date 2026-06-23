import type { ConfigType } from '../../../types/config'

export type CookieMigrationPayload = {
  version: 1
  plugin: 'karin-plugin-hira'
  exportedAt?: string
  cookies: {
    music?: Partial<ConfigType['music']['cookies']>
    resolver?: Partial<ConfigType['resolver']['cookies']>
  }
}

export type CookieImportResult =
  | { ok: true, config: ConfigType, importedCount: number, labels: string[] }
  | { ok: false, message: string }

const cookieLabels = {
  music: {
    netease: '音乐/网易云',
    qq: '音乐/QQ音乐',
    kuwo: '音乐/酷我',
    kugou: '音乐/酷狗',
    bilibili: '音乐/B站'
  },
  resolver: {
    weibo: '解析/微博',
    xiaoheihe: '解析/小黑盒',
    douyin: '解析/抖音',
    xiaohongshu: '解析/小红书',
    bilibili: '解析/B站'
  }
} as const

const pickNonEmptyCookies = <T extends Record<string, string>>(cookies: T) => {
  return Object.fromEntries(
    Object.entries(cookies)
      .map(([key, value]) => [key, value.trim()])
      .filter(([, value]) => value)
  ) as Partial<T>
}

export const exportCookieMigrationPayload = (config: ConfigType, now = new Date()) => {
  const payload: CookieMigrationPayload = {
    version: 1,
    plugin: 'karin-plugin-hira',
    exportedAt: now.toISOString(),
    cookies: {}
  }

  const music = pickNonEmptyCookies(config.music.cookies)
  const resolver = pickNonEmptyCookies(config.resolver.cookies)
  if (Object.keys(music).length > 0) payload.cookies.music = music
  if (Object.keys(resolver).length > 0) payload.cookies.resolver = resolver

  return JSON.stringify(payload, null, 2)
}

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

const parsePayload = (raw: string): CookieMigrationPayload | undefined => {
  try {
    const parsed = JSON.parse(raw)
    if (!isRecord(parsed) || parsed.plugin !== 'karin-plugin-hira' || parsed.version !== 1) return undefined
    if (!isRecord(parsed.cookies)) return undefined
    return parsed as CookieMigrationPayload
  } catch {
    return undefined
  }
}

export const importCookieMigrationPayload = (config: ConfigType, raw: string): CookieImportResult => {
  const payload = parsePayload(raw.trim())
  if (!payload) {
    return { ok: false, message: '迁移内容不是有效的 Hira Cookie JSON。' }
  }

  const nextConfig: ConfigType = structuredClone(config)
  const labels: string[] = []

  const applyMusicCookies = (source: CookieMigrationPayload['cookies']['music'] | undefined) => {
    if (!isRecord(source)) return

    for (const key of Object.keys(cookieLabels.music) as Array<keyof ConfigType['music']['cookies']>) {
      const value = source[key]
      if (typeof value !== 'string' || !value.trim()) continue

      nextConfig.music.cookies[key] = value.trim()
      labels.push(cookieLabels.music[key])
    }
  }

  const applyResolverCookies = (source: CookieMigrationPayload['cookies']['resolver'] | undefined) => {
    if (!isRecord(source)) return

    for (const key of Object.keys(cookieLabels.resolver) as Array<keyof ConfigType['resolver']['cookies']>) {
      const value = source[key]
      if (typeof value !== 'string' || !value.trim()) continue

      nextConfig.resolver.cookies[key] = value.trim()
      labels.push(cookieLabels.resolver[key])
    }
  }

  applyMusicCookies(payload.cookies.music)
  applyResolverCookies(payload.cookies.resolver)

  if (labels.length === 0) {
    return { ok: false, message: '迁移内容里没有可导入的 Cookie。' }
  }

  return {
    ok: true,
    config: nextConfig,
    importedCount: labels.length,
    labels
  }
}
