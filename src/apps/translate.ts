import karin, { type Message } from 'node-karin'

import { isHiraAppEnabled } from '@/apps/runtime'
import { Config } from '@/config'
import { replyPlainText } from '@/services/message'
import { parseTranslateCommand, parseTranslateTargetOnly, translateCommandReg } from '@/translate/commandParser'
import { translateText } from '@/translate/service'

/** 从消息元素里取引用段的 messageId：引用段只带 id，正文要再用 getMsg 取一次。 */
export const findReplyId = (elements: unknown): string | undefined => {
  if (!Array.isArray(elements)) return undefined
  for (const el of elements) {
    if (el && typeof el === 'object' && 'type' in el && 'messageId' in el && el.type === 'reply') {
      const id = el.messageId
      if (typeof id === 'string' && id) return id
    }
  }
  return undefined
}

/**
 * 取 getMsg 返回值里的正文元素。
 * karin 现行实现的返回体是 MessageResponse，正文在 elements；旧适配器只给 message。
 * 先读 elements 再兜底 message，两者都没有时按“取不到正文”处理。
 */
const readQuotedElements = (quoted: unknown): unknown[] | undefined => {
  if (!quoted || typeof quoted !== 'object') return undefined
  const record = quoted as Record<string, unknown>
  for (const key of ['elements', 'message']) {
    const value = record[key]
    if (Array.isArray(value)) return value
  }
  return undefined
}

/**
 * 引用消息的纯文本。
 * 只拼 text 段并 trim：图片/表情会被转成占位串，塞给翻译器只会得到噪声。
 */
export const extractQuotedText = async (e: Message): Promise<string | undefined> => {
  const replyId = findReplyId(e.elements)
  if (!replyId) return undefined
  try {
    const elements = readQuotedElements(await e.bot.getMsg(e.contact, replyId))
    if (!elements) return undefined
    const text = elements
      .filter((el): el is { type: string, text?: unknown } => el !== null && typeof el === 'object' && 'type' in el)
      .filter(el => el.type === 'text')
      .map(el => (typeof el.text === 'string' ? el.text : ''))
      .join('')
      .trim()
    return text || undefined
  } catch {
    // 被撤回、跨群引用或适配器不支持时 getMsg 会抛错，等价于“没有可翻译正文”
    return undefined
  }
}

// `#?` 与仓库内其它命令一致：部分部署会把 `#` 当别名剥掉，部分不会。
// 命令词与目标语言之间不需要空格（R tools.js 切片语义），正文/引用两种形态共用一个入口。
export const translateReg = translateCommandReg

export const translateHandler = async (e: Message, next?: () => unknown) => {
  if (!isHiraAppEnabled()) return next?.()
  if (!Config.translate.enabled) return next?.()

  let command = parseTranslateCommand(e.msg)
  // 无正文时取引用消息文字再翻（R 原版行为）
  if (command.type === 'none') {
    const target = parseTranslateTargetOnly(e.msg)
    if (!target) return next?.()
    const quoted = await extractQuotedText(e)
    if (!quoted) {
      await replyPlainText(e, '请附上要翻译的文本，或引用一条消息后重试')
      return true
    }
    command = { type: 'translate', target, text: quoted }
  }

  try {
    // R tools.js 的 `e.reply(result, true)`：引用回复且不带插件前缀。
    await e.reply(await translateText(command.text, command.target), { reply: true })
  } catch (error) {
    await replyPlainText(e, error instanceof Error ? error.message : String(error))
  }
  return true
}

export const translate = karin.command(translateReg, translateHandler, {
  name: 'Hira-翻译'
})
