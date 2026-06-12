import { Config } from '@/config'
import { fetchJson, fetchText } from '@/services/http'

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

export const readWebPageText = async (url: string) => {
  const html = await fetchText(url, { timeoutMs: 20_000 })
  return stripHtml(html).slice(0, Config.ai.maxInputChars)
}

export const summarizeUrl = async (url: string) => {
  if (!Config.ai.summaryEnabled) throw new Error('网页总结未开启')
  if (!Config.ai.apiKey.trim()) throw new Error('未配置 AI API Key，无法总结')

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
}
