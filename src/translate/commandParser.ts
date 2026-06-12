export type TranslateTarget = 'zh' | 'en' | 'ja' | 'ko' | 'fr' | 'de' | 'ru'

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
  俄文: 'ru'
}

export const parseTranslateCommand = (message: string): TranslateCommand => {
  const match = message.trim().match(/^翻(\S+)\s+([\s\S]+)$/)
  if (!match) return { type: 'none' }

  const target = targetMap[match[1]]
  const text = match[2]?.trim()
  if (!target || !text) return { type: 'none' }

  return { type: 'translate', target, text }
}
