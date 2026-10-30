import { Config } from '@/config'
import { fetchJson } from '@/services/http'
import type { TranslateTarget } from '@/translate/commandParser'

/**
 * 腾讯交互翻译（transmart）协议：
 * 1. `text_analysis` 先探测源语言；
 * 2. `auto_translation` 用探测到的源语言 + 目标语言出译文。
 * 语言码沿用 R constants/constant.js 的 tencentTransMap（补齐云崽缺的法/德/文言文）。
 */
const transmartClientKey = 'browser-firefox-111.0.0-Mac OS-d35fca23-eb48-45ba-9913-114f1177b02b-1679376552800'
const transmartUserAgent = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:109.0) Gecko/20100101 Firefox/111.0'

const transmartLangMap: Record<TranslateTarget, string> = {
  zh: 'zh',
  en: 'en',
  ja: 'ja',
  ko: 'ko',
  fr: 'fr',
  de: 'de',
  ru: 'ru',
  wyw: 'wyw'
}

/** R 探测失败时回落到 `en`；这里用 transmart 支持的 `auto`，避免把中文正文按英文再翻一次。 */
const fallbackSourceLang = 'auto'

type TransmartResponse = {
  header?: { ret_code?: string }
  language?: string
  auto_translation?: unknown
}

type DeepLXResponse = {
  data?: string
}

const callTransmart = async <T>(body: unknown, timeoutMs: number) => fetchJson<T>(Config.translate.tencentApi.trim(), {
  timeoutMs,
  method: 'POST',
  body: JSON.stringify(body),
  headers: {
    'Content-Type': 'application/json',
    'User-Agent': transmartUserAgent
  }
})

/** 探测源语言，失败时返回 `auto`（由后端自行判断），不阻塞翻译主流程。 */
export const detectSourceLanguage = async (text: string, timeoutMs = Config.translate.timeoutSeconds * 1000) => {
  if (!Config.translate.tencentApi.trim()) return fallbackSourceLang
  try {
    const payload = await callTransmart<TransmartResponse>({
      header: { fn: 'text_analysis', client_key: transmartClientKey },
      text,
      type: 'plain',
      normalize: { merge_broken_line: false }
    }, timeoutMs)
    if (payload.header?.ret_code === 'succ' && typeof payload.language === 'string' && payload.language) {
      return payload.language
    }
  } catch {
    // 探测只是锦上添花，失败按 auto 继续走翻译。
  }
  return fallbackSourceLang
}

const translateWithTransmart = async (text: string, target: TranslateTarget, sourceLang: string, timeoutMs: number) => {
  if (!Config.translate.tencentApi.trim()) throw new Error('未配置腾讯翻译接口')

  const payload = await callTransmart<TransmartResponse>({
    header: { fn: 'auto_translation', client_key: transmartClientKey },
    type: 'plain',
    model_category: 'normal',
    text_domain: 'general',
    // R trans-strategy.js 的首尾空串占位：译文固定落在下标 1。
    source: { lang: sourceLang, text_list: ['', text, ''] },
    target: { lang: transmartLangMap[target] }
  }, timeoutMs)

  if (payload.header?.ret_code !== 'succ') {
    throw new Error(`接口返回 ${payload.header?.ret_code || '未知状态'}`)
  }
  const translated = Array.isArray(payload.auto_translation) ? payload.auto_translation[1] : undefined
  if (typeof translated !== 'string' || !translated.trim()) throw new Error('接口没有返回译文')
  return translated.trim()
}

/** deeplxApi 允许逗号分隔多镜像，逐次随机选一个，避免单点镜像挂掉就整体失败。 */
export const resolveDeeplxUrls = (raw: string) => raw.split(',').map(url => url.trim()).filter(Boolean)

export const translateText = async (text: string, target: TranslateTarget) => {
  const timeoutMs = Config.translate.timeoutSeconds * 1000
  const failures: string[] = []
  const sourceLang = await detectSourceLanguage(text, timeoutMs)

  // DeepL 语言表没有 `WYW`（文言文），带配置请求只会白白失败一次再走兜底。
  const deeplxUrls = resolveDeeplxUrls(Config.translate.deeplxApi)
  if (target !== 'wyw' && deeplxUrls.length > 0) {
    const url = deeplxUrls[Math.floor(Math.random() * deeplxUrls.length)]
    try {
      const payload = await fetchJson<DeepLXResponse>(url, {
        timeoutMs,
        method: 'POST',
        body: JSON.stringify({
          text,
          // DeepL 语言码是大小写不敏感的大写形式；探测结果是小写 ISO 码，统一转大写，'auto' 原样保留。
          source_lang: sourceLang === fallbackSourceLang ? sourceLang : sourceLang.toUpperCase(),
          target_lang: target.toUpperCase()
        }),
        headers: { 'Content-Type': 'application/json' }
      })
      const translated = typeof payload.data === 'string' ? payload.data.trim() : ''
      if (translated) return translated
      failures.push('DeepLX 没有返回译文')
    } catch (error) {
      failures.push(`DeepLX：${error instanceof Error ? error.message : String(error)}`)
    }
  }

  try {
    return await translateWithTransmart(text, target, sourceLang, timeoutMs)
  } catch (error) {
    failures.push(`腾讯翻译：${error instanceof Error ? error.message : String(error)}`)
  }

  throw new Error([
    `翻译失败：${failures.join('；')}`,
    '请检查 translate.yaml 的 deeplxApi / tencentApi 配置，或稍后重试。',
    '用法：翻中 hello（目标语言后可以不加空格）'
  ].join('\n'))
}
