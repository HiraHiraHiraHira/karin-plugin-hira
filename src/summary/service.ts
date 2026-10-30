import { setTimeout as delay } from 'node:timers/promises'

import { Config } from '@/config'

import { fetchJson } from '@/services/http'
import { fetchPublicPageText } from './urlSafety'

/**
 * 网页总结 prompt（R constants/constant.js SUMMARY_PROMPT 的结构化版本：
 * 标题 + 摘要 + 带表情的关键段落，输出固定中文）。
 */
export const summaryPrompt = `# Role: Web Content Summarization Assistant

## Profile
- language: 中文
- description: 一个专门用于网页内容摘要的 AI 助手，能提取关键点、总结文章，并给出复杂主题的简洁概览。

## Skills
1. 精通自然语言理解和摘要技术。
2. 能从文章、博客、报告等网页内容里提取关键信息。
3. 能总结短篇和长篇内容，并适应不同写作风格与语调。

## Rules
1. 确保摘要捕捉网页的主要思想和关键点。
2. 摘要简洁、清晰、准确，避免不必要的细节。
3. 根据原文的复杂度和长度调整摘要的详细程度。
4. 保持原文的上下文和意图，不添加个人解释。
5. 输出内容必须为中文。

## Workflows
1. 分析网页的结构和主要部分。
2. 识别并提取关键点、论点或信息。
3. 第一行输出标题，格式固定为："标题: {title}"。
4. 然后输出一段包含最重要细节的简洁摘要。
5. 接着输出"关键段落"，逐条列出关键信息点，每条前带一个表情符号。
6. 审查摘要的准确性和完整性，不要在摘要里复述当前网页的 URL。`

/** 常见自动总结域名的中文名（R constants/constant.js SUMMARY_CONTENT_ESTIMATOR_PATTERNS）。 */
const summarySourceNames: Array<[string, string]> = [
  ['mp.weixin.qq.com', '微信文章'],
  ['bilibili.com', '哔哩哔哩专栏'],
  ['arxiv.org', 'ArXiv论文'],
  ['sspai.com', '少数派'],
  ['zhihu.com', '知乎'],
  ['chinadaily.com.cn', 'ChinaDaily'],
  ['github.com', 'Github'],
  ['v2ex.com', 'V2EX']
]

export const describeSummarySource = (hostname: string) => {
  const host = hostname.toLowerCase()
  const hit = summarySourceNames.find(([domain]) => host === domain || host.endsWith(`.${domain}`))
  return hit ? hit[1] : '网页'
}

/** 域名是否命中自动总结列表（`github.com` 同时覆盖 `www.github.com`）。 */
export const isAutoSummaryHost = (hostname: string, domains: string[]) => {
  const host = hostname.toLowerCase()
  return domains.some((raw) => {
    const domain = raw.trim().toLowerCase()
    return Boolean(domain) && (host === domain || host.endsWith(`.${domain}`))
  })
}

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
/** R utils/common.js retryFetch 默认重试 3 次、间隔 1s。 */
const fetchRetries = 3
const retryDelayMs = 1000
// 只有网络抖动/服务端错误值得重试；地址非法、正文为空重试也没用。
const retryableErrorPattern = /HTTP (?:408|429|5\d\d)|fetch failed|aborted|timed out|timeout|ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|socket hang up/i
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
  let lastError: unknown = new Error('没有读取到可总结的网页正文')
  for (let attempt = 0; attempt <= fetchRetries; attempt++) {
    try {
      const text = stripHtml(await fetchPublicPageText(url)).slice(0, Config.ai.maxInputChars)
      if (!text) throw new Error('没有读取到可总结的网页正文')
      return text
    } catch (error) {
      lastError = error
      const retryable = error instanceof Error && retryableErrorPattern.test(error.message)
      if (!retryable || attempt === fetchRetries) throw error
    }
    await delay(retryDelayMs)
  }
  throw lastError
}

export type SummaryResult = {
  model: string
  charCount: number
  readingMinutes: number
  content: string
}

export const summarizeUrl = async (url: string, requesterKey = 'admin'): Promise<SummaryResult> => {
  if (!Config.ai.summaryEnabled) throw new Error('网页总结未开启')
  if (!Config.ai.apiKey.trim()) throw new Error('未配置 AI API Key，无法总结')

  const release = acquireSummarySlot(requesterKey)
  try {
    const text = await readWebPageText(url)

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
          { role: 'system', content: summaryPrompt },
          { role: 'user', content: `链接：${url}\n\n正文：\n${text}` }
        ],
        temperature: 0.2
      })
    })

    const summary = payload.choices?.[0]?.message?.content?.trim()
    if (!summary) throw new Error('AI 接口没有返回总结')

    return {
      model: Config.ai.model,
      charCount: text.length,
      readingMinutes: Math.max(1, Math.round(text.length / 500)),
      content: summary
    }
  } finally {
    release()
  }
}
