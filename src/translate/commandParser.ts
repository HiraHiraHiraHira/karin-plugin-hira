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

/** 长别名优先，保证 `翻中文hello` 取 `中文` 而不是 `中`。 */
const translateTargetAliases = Object.keys(targetMap).sort((left, right) => right.length - left.length)

// R tools.js 的切片语义：`翻` 后紧跟目标语言，语言与正文之间不需要空格（`翻中hello`）。
// 入口正则只认命令词，目标语言/正文的切分交给 parse*：一个入口同时覆盖
// `翻中hello`（切片语义）、`翻英`（配合引用翻译）和 `翻英 hello`。
export const translateCommandReg = /^#?(?:翻|trans)/i

/** 剥掉命令词，返回目标语言 + 正文；不是翻译命令时返回 undefined。 */
const splitTarget = (message: string) => {
  const trimmed = message.trim()
  const prefix = trimmed.match(translateCommandReg)
  if (!prefix) return undefined

  const rest = trimmed.slice(prefix[0].length)
  for (const alias of translateTargetAliases) {
    if (!rest.startsWith(alias)) continue
    return { target: targetMap[alias], text: rest.slice(alias.length).trim() }
  }
  return undefined
}

export const parseTranslateCommand = (message: string): TranslateCommand => {
  const parsed = splitTarget(message)
  if (!parsed?.text) return { type: 'none' }
  return { type: 'translate', target: parsed.target, text: parsed.text }
}

/** 无正文时仅解析目标语言（配合引用消息翻译），不是翻译命令时返回 undefined。 */
export const parseTranslateTargetOnly = (message: string): TranslateTarget | undefined => {
  const parsed = splitTarget(message)
  if (!parsed || parsed.text) return undefined
  return parsed.target
}
