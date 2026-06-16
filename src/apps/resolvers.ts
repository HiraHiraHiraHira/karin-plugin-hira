import karin from 'node-karin'

import { Config } from '@/config'
import { handleResolverMessage } from '@/resolvers/controller'

const resolverDomainPattern = [
  'bilibili\\.com',
  'b23\\.tv',
  'bili2233\\.cn',
  'douyin\\.com',
  'iesdouyin\\.com',
  'kuaishou\\.com',
  'chenzhongtech\\.com',
  'xiaohongshu\\.com',
  'xhslink\\.com',
  'weibo\\.com',
  'tieba\\.baidu\\.com',
  'xiaoheihe\\.cn',
  'ixigua\\.com',
  'pipix\\.com',
  'pipigx\\.com',
  'xsj\\.qq\\.com',
  'okjike\\.com'
].join('|')

const jsonCardPrefixPattern = String.raw`\s*(?:\{\s*"|\[\s*[{"]|\[json:)`

export const resolverReg = new RegExp(
  String.raw`^(?:${jsonCardPrefixPattern}[\s\S]*https?:\/\/[^\s"'<>]*?(?:${resolverDomainPattern})|(?!${jsonCardPrefixPattern})[\s\S]*https?:\/\/[^\s"'<>]+)`,
  'i'
)

export const resolvers = karin.command(resolverReg, handleResolverMessage, {
  name: 'Hira-多平台解析',
  priority: Config.resolver.priority
})
