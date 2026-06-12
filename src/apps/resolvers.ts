import karin from 'node-karin'

import { Config } from '@/config'
import { handleResolverMessage } from '@/resolvers/controller'

export const resolverReg = /^(?!\s*[\[{])[\s\S]*https?:\/\/[^\s"'<>]+/i

export const resolvers = karin.command(resolverReg, handleResolverMessage, {
  name: 'Hira-多平台解析',
  priority: Config.resolver.priority
})
