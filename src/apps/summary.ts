import karin, { common, segment, type Elements, type Message } from 'node-karin'

import { isHiraAppEnabled } from '@/apps/runtime'
import { Config } from '@/config'
import { hostnameOf } from '@/resolvers/url'
import { replyPlainText, replyText } from '@/services/message'
import { canSendResolverForward, resolveEventForwardIdentity } from '@/services/resolverForward'
import { describeSummarySource, isAutoSummaryHost, summarizeUrl } from '@/summary/service'

/** 显式命令：#总结一下 <链接>（链接后允许跟多余文字，按第一条 http(s) 链接处理）。 */
export const summaryCommandReg = /^#?总结一下/i
const urlPattern = /https?:\/\/[^\s"'<>]+/gi
const trailingPunctuation = /[，。！？、；;,.!?)\]}>》」】]+$/

/**
 * 自动总结入口：消息里带链接就进来，域名再按 `ai.autoSummaryDomains` 实时判定
 * （karin 的命令正则在模块加载时固化，把域名写进正则会让改配置后不生效）。
 * R tools.js 用 linkShareSummary 规则做同样的事。
 */
export const autoSummaryReg = /https?:\/\//i

const requestUrls = (message: string) => (message.match(urlPattern) ?? [])
  .map(url => url.replace(trailingPunctuation, ''))
  .filter((url) => {
    try {
      const parsed = new URL(url)
      return ['http:', 'https:'].includes(parsed.protocol)
    } catch {
      return false
    }
  })

/**
 * R query.js 的 makeForwardMsg：总结结果收进一条聊天记录。
 * 适配器不支持合并转发时退回纯文本。
 */
const sendSummaryForward = async (e: Message, lines: string[], title: string) => {
  if (canSendResolverForward(e)) {
    const identity = resolveEventForwardIdentity(e, title)
    try {
      await e.bot.sendForwardMsg(
        e.contact,
        common.makeForward(lines.map(line => [segment.text(line)] as Elements[]), identity.id, identity.name),
        {
          source: title,
          summary: '查看网页总结',
          prompt: '查看网页总结',
          news: [{ text: '点击查看完整总结' }]
        }
      )
      return
    } catch {
      // 部分适配器声明了 sendForwardMsg 但群里不可用，继续走纯文本
    }
  }
  await replyPlainText(e, lines.join('\n\n'))
}

const requesterKey = (e: Message) => String(e.userId || e.selfId)

const runSummary = async (e: Message, url: string) => {
  try {
    // 先判配置再回执，避免「正在总结」之后紧跟一条失败提示（R 也先报未配置）
    if (!Config.ai.summaryEnabled) throw new Error('网页总结未开启，请先在配置中启用')
    if (!Config.ai.apiKey.trim()) throw new Error('未配置 AI API Key，无法总结')

    await replyText(e, `识别：${describeSummarySource(hostnameOf(url) || '')}，正在为您总结，请稍等...`)
    const result = await summarizeUrl(url, requesterKey(e))
    await sendSummaryForward(e, [
      `「Hira × ${result.model}」联合为您总结内容：`,
      result.content,
      `原文约 ${result.charCount} 字，预计阅读 ${result.readingMinutes} 分钟。`
    ], '网页总结')
  } catch (error) {
    await replyPlainText(e, `总结失败：${error instanceof Error ? error.message : String(error)}`)
  }
}

export const summaryHandler = async (e: Message, next?: () => unknown) => {
  if (!isHiraAppEnabled()) return next?.()

  const message = e.msg.trim()
  if (!summaryCommandReg.test(message)) return next?.()

  const url = requestUrls(message.replace(summaryCommandReg, ''))[0]
  if (!url) {
    // 只有显式命令（以 # 开头）才回用法; "总结一下今天的事"这类闲聊必须放行给其它插件.
    if (!message.startsWith('#')) return next?.()
    // R llm-util.js 的 llmRead：非 http(s) 链接直接告知格式无效，而不是静默丢弃
    await replyPlainText(e, '链接格式无效，请发送 http/https 链接。例：#总结一下 https://example.com/article')
    return true
  }

  await runSummary(e, url)
  return true
}

export const summaryAutoHandler = async (e: Message, next?: () => unknown) => {
  if (!isHiraAppEnabled()) return next?.()
  if (!Config.ai.summaryEnabled) return next?.()

  const message = e.msg.trim()
  // 显式命令交给 summaryHandler，避免同一条消息总结两次
  if (summaryCommandReg.test(message)) return next?.()

  const url = requestUrls(message)
    .find(candidate => isAutoSummaryHost(hostnameOf(candidate) || '', Config.ai.autoSummaryDomains))
  if (!url) return next?.()

  await runSummary(e, url)
  return true
}

export const summary = karin.command(summaryCommandReg, summaryHandler, {
  name: 'Hira-AI总结',
  perm: 'admin'
})

export const summaryAuto = karin.command(autoSummaryReg, summaryAutoHandler, {
  name: 'Hira-AI自动总结',
  // 必须晚于 light/translate/music/resolver(670-900) 等命令: 否则"#点歌 晴天 <github 链接>"
  // 会先被自动总结吞掉. 同一条消息若已被其它 Hira 命令消费就不会走到这里.
  priority: 950
})
