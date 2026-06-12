import { describe, expect, it } from 'vitest'

import { parseTranslateCommand } from '@/translate/commandParser'

describe('parseTranslateCommand', () => {
  it('parses target language aliases', () => {
    expect(parseTranslateCommand('翻中 hello')).toEqual({ type: 'translate', target: 'zh', text: 'hello' })
    expect(parseTranslateCommand('翻英 你好')).toEqual({ type: 'translate', target: 'en', text: '你好' })
    expect(parseTranslateCommand('翻日 你好')).toEqual({ type: 'translate', target: 'ja', text: '你好' })
  })

  it('ignores empty or unsupported commands', () => {
    expect(parseTranslateCommand('翻中')).toEqual({ type: 'none' })
    expect(parseTranslateCommand('翻火星 hello')).toEqual({ type: 'none' })
  })
})
