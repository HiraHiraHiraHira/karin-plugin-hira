import type { Message } from 'node-karin'

import { isHiraAppEnabled } from '@/apps/runtime'
import { Config, updateMusicCookie } from '@/config'
import { maskCookie, parseMusicCookieCommand } from '@/music/cookieCommand'
import { getMusicCookieStatusLines } from '@/music/cookieStatus'
import type { MusicSource } from '@/music/types'
import { buildStatusCardHtml, logCardRenderFailure, renderCardImage } from '@/services/cardRender'
import { replyText } from '@/services/message'

const sourceName = (source: MusicSource) => ({
  netease: '网易云',
  qq: 'QQ音乐',
  kuwo: '酷我',
  kugou: '酷狗',
  bilibili: '哔哩哔哩'
})[source]

const isPrivileged = (e: Message) => Boolean(e.isMaster || e.isAdmin)

type ReplyPayload = Parameters<Message['reply']>[0]

const splitStatusLine = (line: string) => {
  const index = line.indexOf('：')
  if (index < 0) return { label: line, value: '', detail: '' }

  const label = line.slice(0, index)
  const rawValue = line.slice(index + 1)
  const detailMatch = rawValue.match(/^(.+?)（(.+)）$/)
  if (!detailMatch) return { label, value: rawValue, detail: '' }
  return {
    label,
    value: detailMatch[1] || rawValue,
    detail: detailMatch[2] || ''
  }
}

const cookieStatusKind = (value: string): 'ok' | 'off' | 'warn' | 'info' => {
  if (/在线|已配置/.test(value)) return 'ok'
  if (/未配置/.test(value)) return 'off'
  if (/失效|失败/.test(value)) return 'warn'
  return 'info'
}

export const replyMusicCookieStatus = async (e: Message) => {
  const lines = await getMusicCookieStatusLines(Config.music)

  try {
    const items = lines.slice(1).map(line => {
      const parsed = splitStatusLine(line)
      return {
        label: parsed.label,
        value: parsed.value,
        detail: parsed.detail,
        status: cookieStatusKind(parsed.value)
      }
    })

    const images = await renderCardImage({
      name: 'music-cookie-status',
      html: buildStatusCardHtml({
        title: '音乐 Cookie 状态',
        subtitle: '各平台登录态和配置状态。',
        eyebrow: 'MUSIC.COOKIE',
        items
      }),
      width: 920
    })
    await e.reply(images as ReplyPayload)
  } catch (error) {
    logCardRenderFailure('music-cookie-status', error)
    await replyText(e, lines.join('\n'))
  }
}

export const handleMusicCookieMessage = async (e: Message, next?: () => unknown) => {
  if (!isHiraAppEnabled()) return next?.()

  const command = parseMusicCookieCommand(e.msg)
  if (command.type === 'none') return next?.()

  if (!isPrivileged(e)) {
    await replyText(e, '音乐 Cookie 只能由主人或管理员管理')
    return true
  }

  if (command.type === 'submit') {
    updateMusicCookie(command.source, command.cookie)
    await replyText(e, `已更新 ${sourceName(command.source)} Cookie：${maskCookie(command.cookie)}`)
    return true
  }

  await replyMusicCookieStatus(e)
  return true
}
