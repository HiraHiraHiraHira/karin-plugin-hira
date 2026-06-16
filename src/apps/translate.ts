import karin from 'node-karin'

import { isHiraAppEnabled } from '@/apps/runtime'
import { Config } from '@/config'
import { replyText } from '@/services/message'
import { parseTranslateCommand } from '@/translate/commandParser'
import { translateText } from '@/translate/service'

const translateReg = /^翻\S+\s+[\s\S]+$/i

export const translate = karin.command(translateReg, async (e, next) => {
  if (!isHiraAppEnabled()) return next?.()
  if (!Config.translate.enabled) return next?.()
  const command = parseTranslateCommand(e.msg)
  if (command.type === 'none') return next?.()

  try {
    await replyText(e, await translateText(command.text, command.target))
  } catch (error) {
    await replyText(e, error instanceof Error ? error.message : String(error))
  }
  return true
}, {
  name: 'Hira-翻译',
  priority: 670
})
