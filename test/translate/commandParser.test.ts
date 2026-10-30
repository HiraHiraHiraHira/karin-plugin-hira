import { describe, expect, it } from 'vitest'

import {
  parseTranslateCommand,
  parseTranslateTargetOnly,
  translateCommandReg
} from '@/translate/commandParser'

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

  it('支持目标语言后不带空格的写法（R tools.js 切片语义）', () => {
    expect(parseTranslateCommand('翻中hello')).toEqual({ type: 'translate', target: 'zh', text: 'hello' })
    expect(parseTranslateCommand('翻英hello world')).toEqual({ type: 'translate', target: 'en', text: 'hello world' })
    expect(parseTranslateCommand('#trans日你好')).toEqual({ type: 'translate', target: 'ja', text: '你好' })
    expect(parseTranslateCommand('翻中文hello')).toEqual({ type: 'translate', target: 'zh', text: 'hello' })
  })

  it('入口正则只认命令词，切分交给 parse*', () => {
    expect(translateCommandReg.test('翻中hello')).toBe(true)
    expect(translateCommandReg.test('#trans英你好')).toBe(true)
    expect(translateCommandReg.test('今天天气')).toBe(false)
  })
})
