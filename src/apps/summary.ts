import karin from 'node-karin'

import { replyText } from '@/services/message'
import { summarizeUrl } from '@/summary/service'

const summaryReg = /^#?总结一下\s+(https?:\/\/[^\s"'<>]+)$/i

export const summary = karin.command(summaryReg, async (e, next) => {
  const match = e.msg.trim().match(summaryReg)
  if (!match?.[1]) return next?.()

  try {
    await replyText(e, '识别：网页总结，正在为您总结，请稍等...')
    await replyText(e, await summarizeUrl(match[1]))
  } catch (error) {
    await replyText(e, error instanceof Error ? error.message : String(error))
  }
  return true
}, {
  name: 'Hira-AI总结',
  priority: 660
})
