import { logger, mkdirSync } from 'node-karin'
import { karinPathBase } from 'node-karin/root'

import './apps/help'
import './apps/light'
import './apps/music'
import './apps/resolvers'
import './apps/status'
import './apps/summary'
import './apps/translate'
import './server/register'

import { initConfig } from './config'
import { Root } from './root'

initConfig()

mkdirSync(`${karinPathBase}/${Root.pluginName}/data`)

const start = globalThis.__hiraLoadStart
const elapsedMs = typeof start === 'bigint'
  ? Number(process.hrtime.bigint() - start) / 1_000_000
  : 0

const timeText = elapsedMs >= 1000
  ? `${Number((elapsedMs / 1000).toFixed(2))}s`
  : `${Math.round(elapsedMs)}ms`

logger.info(`${logger.violet(`[插件:${Root.pluginName}]`)} ${logger.green(`v${Root.pluginVersion}`)} 初始化完成 ~ 耗时 ${logger.green(timeText)}`)

delete (globalThis as Record<string, unknown>).__hiraLoadStart
