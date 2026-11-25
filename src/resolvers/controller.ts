import type { Message } from 'node-karin'

import { isGroupModuleEnabled, isHiraAppEnabled } from '@/apps/runtime'
import { Config } from '@/config'
import { replyResolvedPost } from '@/services/message'

import { resolveBilibili } from './bilibili'
import { resolveDouyin } from './douyin'
import { resolveGeneral } from './general'
import { shouldSkipForKkkCompat } from './kkkCompat'
import { resolveKuaishou } from './kuaishou'
import { matchResolver } from './matcher'
import { logResolverStage } from './resolverLog'
import { resolveTieba } from './tieba'
import type { ResolvedPost, ResolverResult } from './types'
import { extractFirstUrl, extractShareCardMeta } from './url'
import { resolveWeibo } from './weibo'
import { resolveXiaoheihe } from './xiaoheihe'
import { resolveXiaohongshu } from './xiaohongshu'

const RESOLVER_CACHE_TTL_MS = 3 * 60_000
const RESOLVER_CACHE_MAX = 200
const RESOLVER_COOLDOWN_MS = 15_000
const RESOLVER_COOLDOWN_MAX = 500

type CachedResolveEntry = {
  result: ResolvedPost
  expiresAt: number
}

const resolveResultCache = new Map<string, CachedResolveEntry>()
const inFlightResolves = new Map<string, Promise<ResolverResult>>()
const recentPeerUrls = new Map<string, number>()

export const resetResolverGuard = () => {
  resolveResultCache.clear()
  inFlightResolves.clear()
  recentPeerUrls.clear()
}

const getCachedResult = (cacheKey: string, now: number): ResolvedPost | undefined => {
  const entry = resolveResultCache.get(cacheKey)
  if (!entry) return undefined
  if (entry.expiresAt <= now) {
    resolveResultCache.delete(cacheKey)
    return undefined
  }
  // LRU: 刷新顺序
  resolveResultCache.delete(cacheKey)
  resolveResultCache.set(cacheKey, entry)
  return entry.result
}

const setCachedResult = (cacheKey: string, result: ResolvedPost, now: number) => {
  resolveResultCache.delete(cacheKey)
  resolveResultCache.set(cacheKey, { result, expiresAt: now + RESOLVER_CACHE_TTL_MS })
  if (resolveResultCache.size > RESOLVER_CACHE_MAX) {
    const oldestKey = resolveResultCache.keys().next().value
    if (oldestKey !== undefined) resolveResultCache.delete(oldestKey)
  }
}

const checkAndMarkCooldown = (peerKey: string, now: number) => {
  const last = recentPeerUrls.get(peerKey)
  if (last !== undefined && now - last < RESOLVER_COOLDOWN_MS) return true
  recentPeerUrls.delete(peerKey)
  recentPeerUrls.set(peerKey, now)
  if (recentPeerUrls.size > RESOLVER_COOLDOWN_MAX) {
    for (const [k, ts] of recentPeerUrls) {
      if (now - ts >= RESOLVER_COOLDOWN_MS || recentPeerUrls.size > RESOLVER_COOLDOWN_MAX) {
        recentPeerUrls.delete(k)
      }
      if (recentPeerUrls.size <= RESOLVER_COOLDOWN_MAX) break
    }
  }
  return false
}

const resolveMatched = async (
  match: NonNullable<ReturnType<typeof matchResolver>>,
  url: string,
  config: typeof Config.resolver,
  message = ''
): Promise<ResolverResult> => {
  const shareMeta = extractShareCardMeta(message)

  if (match.platform === 'bilibili') return resolveBilibili(url, config.cookies.bilibili)
  if (match.platform === 'douyin') return resolveDouyin(url, config.cookies.douyin, config.generalApis)
  if (match.platform === 'weibo') return resolveWeibo(url, config.cookies.weibo)
  if (match.platform === 'tieba') return resolveTieba(url, config.generalApis, shareMeta)
  if (match.platform === 'xiaoheihe') return resolveXiaoheihe(url, config.cookies.xiaoheihe)
  if (match.platform === 'xiaohongshu') return resolveXiaohongshu(url, config.cookies.xiaohongshu)
  if (match.platform === 'kuaishou') return resolveKuaishou(url, config.generalApis)

  return resolveGeneral(url, config.generalApis)
}

export const handleResolverMessage = async (e: Message, next?: () => unknown) => {
  if (!isHiraAppEnabled()) return next?.()
  const config = Config.resolver
  if (!config.enabled) return next?.()
  if (!isGroupModuleEnabled(e, 'resolve')) return next?.()

  const url = extractFirstUrl(e.msg)
  if (!url) return next?.()

  if (shouldSkipForKkkCompat(url, config.kkkCompat)) return next?.()

  const match = matchResolver(url)
  if (!match) return next?.()
  // 平台级开关：关掉 B站 后，B站链接放行给别的插件，其它平台的解析不受影响
  if (!isGroupModuleEnabled(e, `resolve:${match.platform}`)) {
    logResolverStage({
      platform: match.platform,
      stage: 'match',
      ok: false,
      reason: 'platform switch off',
      url
    })
    return next?.()
  }
  if (config.platforms[match.platform] === false) {
    logResolverStage({
      platform: match.platform,
      stage: 'match',
      ok: false,
      reason: 'platform disabled',
      url
    })
    return next?.()
  }

  const now = Date.now()
  const peer = (e as Message & { contact?: { peer?: string } }).contact?.peer
  if (peer && checkAndMarkCooldown(`${e.selfId || ''}:${peer}:${url}`, now)) {
    logResolverStage({
      platform: match.platform,
      stage: 'match',
      ok: false,
      reason: 'cooldown',
      url
    })
    return true
  }

  logResolverStage({ platform: match.platform, stage: 'match', ok: true, url })

  const cacheKey = `${match.platform}:${url}`
  const cached = getCachedResult(cacheKey, now)
  let result: ResolverResult
  if (cached) {
    result = cached
  } else {
    let pending = inFlightResolves.get(cacheKey)
    if (!pending) {
      pending = resolveMatched(match, url, config, e.msg)
        .catch((error: unknown): ResolverResult => ({
          platform: match.platform,
          displayName: match.displayName,
          ok: false,
          reason: error instanceof Error ? error.message : String(error)
        }))
        .finally(() => {
          inFlightResolves.delete(cacheKey)
        })
      inFlightResolves.set(cacheKey, pending)
    }
    result = await pending
    if (!('ok' in result)) {
      setCachedResult(cacheKey, result, Date.now())
    }
  }

  logResolverStage({
    platform: match.platform,
    stage: 'normalize',
    ok: !('ok' in result),
    reason: 'ok' in result ? result.reason : undefined,
    url
  })
  try {
    await replyResolvedPost(e, result)
    logResolverStage({ platform: match.platform, stage: 'send', ok: true, url })
  } catch (error) {
    logResolverStage({
      platform: match.platform,
      stage: 'send',
      ok: false,
      reason: error instanceof Error ? error.message : String(error),
      url
    })
    throw error
  }
  return true
}
