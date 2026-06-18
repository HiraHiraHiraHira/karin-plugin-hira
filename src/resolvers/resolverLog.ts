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

const sensitiveKeyPattern = /cookie|authorization|token|secret|session|auth/i

const valueText = (value: unknown) => String(value ?? '').replace(/\s+/g, ' ').trim()

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
  .map(([key, value]) => `extra.${key}=${valueText(value)}`)

export const buildResolverStageLog = (options: ResolverStageLogOptions) => {
  const parts = [
    `[resolver:${options.platform}]`,
    `stage=${options.stage}`,
    `ok=${options.ok}`
  ]
  if (options.reason) parts.push(`reason=${valueText(options.reason)}`)
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
