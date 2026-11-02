import { Config } from '@/config'

import { fetchJson } from '@/services/http'
import { fetchPublicPageText } from './urlSafety'

const stripHtml = (html: string) => html
  .replace(/<script[\s\S]*?<\/script>/gi, '')
  .replace(/<style[\s\S]*?<\/style>/gi, '')
  .replace(/<[^>]+>/g, '\n')
  .replace(/&nbsp;/g, ' ')
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>')
  .replace(/&amp;/g, '&')
  .replace(/\n{3,}/g, '\n\n')
  .trim()

type RateState = {
  timestamps: number[]
}

const rateWindowMs = 5 * 60_000
const rateLimit = 3
const maxConcurrent = 2
/** 限流状态最多保留的请求人条数，避免 Map 只增不减 */
const maxRateStates = 500
const rateStates = new Map<string, RateState>()
let activeRequests = 0

/** 清掉窗口外、已经没有任何有效时间戳的条目 */
const pruneExpiredRateStates = (now: number) => {
  for (const [key, state] of rateStates) {
    if (state.timestamps.every(timestamp => now - timestamp >= rateWindowMs)) rateStates.delete(key)
  }
}

/** 条目数超上限时删掉最久未活跃的，保证 Map 不会无限增长 */
const enforceRateStateLimit = () => {
  if (rateStates.size <= maxRateStates) return
  const oldestFirst = [...rateStates.entries()].sort((left, right) => {
    const leftLast = left[1].timestamps[left[1].timestamps.length - 1] ?? 0
    const rightLast = right[1].timestamps[right[1].timestamps.length - 1] ?? 0
    return leftLast - rightLast
  })
  for (const [key] of oldestFirst.slice(0, rateStates.size - maxRateStates)) rateStates.delete(key)
}

export const acquireSummarySlot = (requesterKey: string) => {
  const now = Date.now()
  pruneExpiredRateStates(now)
  const state = rateStates.get(requesterKey) || { timestamps: [] }
  state.timestamps = state.timestamps.filter(timestamp => now - timestamp < rateWindowMs)
  if (state.timestamps.length >= rateLimit) throw new Error('网页总结请求过于频繁，请稍后再试')
  if (activeRequests >= maxConcurrent) throw new Error('当前网页总结任务较多，请稍后再试')

  state.timestamps.push(now)
  rateStates.set(requesterKey, state)
  enforceRateStateLimit()
  activeRequests += 1
  return () => {
    activeRequests = Math.max(0, activeRequests - 1)
  }
}

/** 仅用于测试：读取当前限流状态条目数 */
export const getSummaryRateStateCount = () => rateStates.size

/** 仅用于测试：重置限流状态 */
export const resetSummaryRateStates = () => {
  rateStates.clear()
  activeRequests = 0
}

export const readWebPageText = async (url: string) => {
  const html = await fetchPublicPageText(url)
  return stripHtml(html).slice(0, Config.ai.maxInputChars)
}

export const summarizeUrl = async (url: string, requesterKey = 'admin') => {
  if (!Config.ai.summaryEnabled) throw new Error('网页总结未开启')
  if (!Config.ai.apiKey.trim()) throw new Error('未配置 AI API Key，无法总结')

  const release = acquireSummarySlot(requesterKey)
  try {
    const text = await readWebPageText(url)
    if (!text) throw new Error('没有读取到可总结的网页正文')

    const endpoint = `${Config.ai.apiBaseUrl.replace(/\/$/, '')}/chat/completions`
    const payload = await fetchJson<{
      choices?: Array<{ message?: { content?: string } }>
    }>(endpoint, {
      timeoutMs: 60_000,
      method: 'POST',
      headers: {
        Authorization: `Bearer ${Config.ai.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: Config.ai.model,
        messages: [
          { role: 'system', content: '你是网页总结助手。请用中文总结核心内容、要点和需要注意的信息。' },
          { role: 'user', content: `链接：${url}\n\n正文：\n${text}` }
        ],
        temperature: 0.2
      })
    })

    const summary = payload.choices?.[0]?.message?.content?.trim()
    if (!summary) throw new Error('AI 接口没有返回总结')

    const readingMinutes = Math.max(1, Math.round(text.length / 500))
    return `网页总结\n原文约 ${text.length} 字，预计阅读 ${readingMinutes} 分钟。\n\n${summary}`
  } finally {
    release()
  }
}
