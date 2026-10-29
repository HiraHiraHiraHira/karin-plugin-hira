import { describe, expect, it } from 'vitest'

import { parseTranslateCommand, parseTranslateTargetOnly } from '@/translate/commandParser'

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

  it('supports trans alias and wenyan target', () => {
    expect(parseTranslateCommand('trans英 你好')).toEqual({ type: 'translate', target: 'en', text: '你好' })
    expect(parseTranslateCommand('翻文 hello')).toEqual({ type: 'translate', target: 'wyw', text: 'hello' })
    expect(parseTranslateTargetOnly('翻英')).toBe('en')
    expect(parseTranslateTargetOnly('trans日')).toBe('ja')
    expect(parseTranslateTargetOnly('今天天气')).toBeUndefined()
  })

  it('parses trans with the wenyan target and an optional command prefix', () => {
    expect(parseTranslateCommand('trans文言文 你好')).toEqual({ type: 'translate', target: 'wyw', text: '你好' })
    expect(parseTranslateTargetOnly('trans文言文')).toBe('wyw')
    expect(parseTranslateTargetOnly('#翻英')).toBe('en')
    expect(parseTranslateCommand('#trans英 你好')).toEqual({ type: 'translate', target: 'en', text: '你好' })
  })
})
