import { logger as karinLogger } from 'node-karin'

import { Config } from '@/config'

import type { ResolverPlatform } from './types'

export type ResolverStage =
  | 'match'
  | 'prepare'
  | 'cookie'
  | 'api'
  | 'fallback'
  | 'normalize'
  | 'media'
  | 'render'
  | 'send'

export type ResolverStageLogOptions = {
  platform: ResolverPlatform
  stage: ResolverStage
  ok: boolean
  reason?: string
  url?: string
  cookie?: string
  extra?: Record<string, unknown>
}

type ResolverLogger = {
  debug?: (message: string) => void
  warn?: (message: string) => void
}

// 裸 `key` 会误伤 `keyword` 这类普通 extra 字段，凭据键单独在 `redactSecrets` 里按
// query 参数名脱敏，这里只过滤明确的键名。
const sensitiveKeyPattern = /cookie|authorization|token|secret|session|auth|skey|p_skey|clientkey|apikey|api_key/i

const valueText = (value: unknown) => String(value ?? '').replace(/\s+/g, ' ').trim()

/** 失败原因常直接来自上游错误或卡片 URL，必须擦掉 query 里的 skey/token 类参数后才能落日志。 */
const redactSecrets = (value: unknown) => valueText(value).replace(
  /([?&](?:skey|p_skey|access_token|token|key|sign|code|ticket)=)[^&\s]+/gi,
  '$1***'
)

const safeHost = (url: string | undefined) => {
  if (!url) return undefined
  try {
    return new URL(url).host
  } catch {
    return undefined
  }
}

const safeExtraEntries = (extra: Record<string, unknown> | undefined) => Object.entries(extra || {})
  .filter(([key]) => !sensitiveKeyPattern.test(key))
  .map(([key, value]) => `extra.${key}=${redactSecrets(value)}`)

export const buildResolverStageLog = (options: ResolverStageLogOptions) => {
  const parts = [
    `[resolver:${options.platform}]`,
    `stage=${options.stage}`,
    `ok=${options.ok}`
  ]
  if (options.reason) parts.push(`reason=${redactSecrets(options.reason)}`)
  const host = safeHost(options.url)
  if (host) parts.push(`urlHost=${host}`)
  if (options.cookie !== undefined) parts.push(`cookie=${options.cookie.trim() ? 'present' : 'empty'}`)
  parts.push(...safeExtraEntries(options.extra))
  return parts.join(' ')
}

export const logResolverStage = (options: ResolverStageLogOptions, logger: ResolverLogger = karinLogger) => {
  const diagnostics = Config.resolver.diagnostics
  if (diagnostics.stageLogsEnabled === false) return
  if (options.ok && diagnostics.verboseLogsEnabled === false) return

  const line = buildResolverStageLog(options)
  if (options.ok) {
    logger.debug?.(line)
    return
  }
  logger.warn?.(line)
}
