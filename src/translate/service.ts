import { Config } from '@/config'
import { fetchJson } from '@/services/http'
import type { TranslateTarget } from '@/translate/commandParser'

type DeepLXResponse = {
  data?: string
  alternatives?: string[]
}

type TencentLikeResponse = {
  target_text?: string
  data?: {
    target_text?: string
    translation?: string
  }
}

export const translateText = async (text: string, target: TranslateTarget) => {
  const timeoutMs = Config.translate.timeoutSeconds * 1000

  // DeepL 语言表没有 `WYW`（文言文），带配置请求只会白白失败一次再走兜底；
  // 文言文直接交给 tencent 兼容接口（其 `target` 原样透传，由后端解析 wyw）。
  if (target !== 'wyw' && Config.translate.deeplxApi.trim()) {
    try {
      const payload = await fetchJson<DeepLXResponse>(Config.translate.deeplxApi, {
        timeoutMs,
        method: 'POST',
        body: JSON.stringify({
          text,
          source_lang: 'auto',
          target_lang: target.toUpperCase()
        }),
        headers: {
          'Content-Type': 'application/json'
        }
      })
      if (payload.data) return payload.data
    } catch {
      // Fall back to Tencent-compatible endpoint.
    }
  }

  const payload = await fetchJson<TencentLikeResponse>(Config.translate.tencentApi, {
    timeoutMs,
    method: 'POST',
    body: JSON.stringify({
      source: 'auto',
      target,
      source_text: text,
      text
    }),
    headers: {
      'Content-Type': 'application/json'
    }
  })

  const translated = payload.target_text ?? payload.data?.target_text ?? payload.data?.translation
  if (!translated) throw new Error('翻译接口没有返回结果')
  return translated
}
