import karin from 'node-karin'

import { RESOLVER_DOMAIN_PATTERN } from '@/resolvers/matcher'
import { handleResolverMessage } from '@/resolvers/controller'

const jsonCardPrefixPattern = String.raw`\s*(?:\{\s*"|\[\s*[{"]|\[json:)`

/**
 * 命令层只做廉价预筛：消息里出现链接本身即可，是否由 Hira 处理交给 controller 的
 * `extractFirstUrl` + `matchResolver` 决定，避免这里维护第二份平台域名表。
 * JSON 卡片需要额外出现可解析域名，避免吞掉其它插件分享的音乐卡片。
 * 裸 BV/AcFun 编号（无链接纯文本分享）也放行，由 controller 的裸 ID 补全承接；
 * 字符集与 `expandBareShareId` 保持一致，预筛放过但补全不出的组合不存在。
 */
const bareShareIdPattern = String.raw`(?<![0-9A-Za-z])(?:BV[1-9A-HJ-NP-Za-km-z]{10}(?![0-9A-Za-z])(?!\.\w{1,4}\b)|ac\d{6,}(?![0-9A-Za-z]))`
export const resolverReg = new RegExp(
  String.raw`^(?:${jsonCardPrefixPattern}[\s\S]*https?:\/\/[^\s"'<>]*(?:${RESOLVER_DOMAIN_PATTERN})|(?!${jsonCardPrefixPattern})[\s\S]*(?:https?:\/\/[^\s"'<>]+|${bareShareIdPattern}))`,
  'i'
)

export const resolvers = karin.command(resolverReg, handleResolverMessage, {
  name: 'Hira-多平台解析'
})
