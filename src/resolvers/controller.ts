import type { Message } from 'node-karin'

import { Config } from '@/config'
import { replyResolvedPost } from '@/services/message'

import { resolveBilibili } from './bilibili'
import { resolveDouyin } from './douyin'
import { resolveByGeneralApis } from './general'
import { shouldSkipForKkkCompat } from './kkkCompat'
import { resolveKuaishou } from './kuaishou'
import { matchResolver } from './matcher'
import { resolveTieba } from './tieba'
import type { ResolverResult } from './types'
import { extractFirstUrl } from './url'
import { resolveWeibo } from './weibo'
import { resolveXiaoheihe } from './xiaoheihe'
import { resolveXiaohongshu } from './xiaohongshu'

const resolveMatched = async (url: string): Promise<ResolverResult> => {
  const match = matchResolver(url)
  if (!match) return { platform: 'general', displayName: '通用解析', ok: false, reason: '暂不支持该链接' }

  const config = Config.resolver

  if (match.platform === 'bilibili') return resolveBilibili(url, config.cookies.bilibili)
  if (match.platform === 'douyin') return resolveDouyin(url, config.cookies.douyin, config.generalApis)
  if (match.platform === 'weibo') return resolveWeibo(url, config.cookies.weibo)
  if (match.platform === 'tieba') return resolveTieba(url, config.generalApis)
  if (match.platform === 'xiaoheihe') return resolveXiaoheihe(url, config.cookies.xiaoheihe)
  if (match.platform === 'xiaohongshu') return resolveXiaohongshu(url, config.cookies.xiaohongshu)
  if (match.platform === 'kuaishou') return resolveKuaishou(url, config.generalApis)

  return resolveByGeneralApis(match.displayName, url, config.generalApis)
}

export const handleResolverMessage = async (e: Message, next?: () => unknown) => {
  if (!Config.resolver.enabled) return next?.()

  const url = extractFirstUrl(e.msg)
  if (!url) return next?.()

  if (shouldSkipForKkkCompat(url, Config.resolver.kkkCompat)) return next?.()

  const match = matchResolver(url)
  if (!match) return next?.()

  const result = await resolveMatched(url)
  await replyResolvedPost(e, result)
  return true
}
