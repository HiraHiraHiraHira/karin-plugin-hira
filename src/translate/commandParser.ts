export type TranslateTarget = 'zh' | 'en' | 'ja' | 'ko' | 'fr' | 'de' | 'ru' | 'wyw'

export type TranslateCommand =
  | { type: 'translate', target: TranslateTarget, text: string }
  | { type: 'none' }

const targetMap: Record<string, TranslateTarget> = {
  中: 'zh',
  中文: 'zh',
  英: 'en',
  英文: 'en',
  日: 'ja',
  日文: 'ja',
  韩: 'ko',
  韩文: 'ko',
  法: 'fr',
  法文: 'fr',
  德: 'de',
  德文: 'de',
  俄: 'ru',
  俄文: 'ru',
  文: 'wyw',
  文言文: 'wyw'
}

// 与 apps/translate 的 translateReg 同口径：`#` 只是可选命令前缀，不属于目标语言。
const commandPattern = /^#?(?:翻|trans)(\S+)\s+([\s\S]+)$/i
const targetOnlyPattern = /^#?(?:翻|trans)(\S+)\s*$/i

export const parseTranslateCommand = (message: string): TranslateCommand => {
  const match = message.trim().match(commandPattern)
  if (!match) return { type: 'none' }

  const target = targetMap[match[1]]
  const text = match[2]?.trim()
  if (!target || !text) return { type: 'none' }

  return { type: 'translate', target, text }
}

/** 无正文时仅解析目标语言（配合引用消息翻译），不是翻译命令时返回 undefined。 */
export const parseTranslateTargetOnly = (message: string): TranslateTarget | undefined => {
  const match = message.trim().match(targetOnlyPattern)
  if (!match) return undefined
  return targetMap[match[1]]
}
