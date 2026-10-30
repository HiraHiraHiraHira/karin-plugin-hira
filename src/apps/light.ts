import karin, { common, segment, type Elements, type Message } from 'node-karin'

import { isHiraAppEnabled } from '@/apps/runtime'
import { Config } from '@/config'
import { lightCommandReg, parseLightCommand } from '@/light/commandParser'
import {
  getBuyerShowImage,
  getCatImages,
  getTiredImages,
  queryMedicine,
  querySoftware,
  tiredPrompt
} from '@/light/service'
import { replyImage, replyPlainText } from '@/services/message'
import { canSendResolverForward, resolveEventForwardIdentity } from '@/services/resolverForward'

const CAT_COUNT = 10

/**
 * R query.js 用 `makeForwardMsg` 合并转发：多图/多条结果都收在一条聊天记录里。
 * 适配器不支持转发或转发失败时，退回调用方给的兜底发送。
 */
const sendForward = async (
  e: Message,
  messages: Elements[][],
  options: { title: string, prompt: string, fallback: () => Promise<unknown> }
) => {
  if (canSendResolverForward(e)) {
    const identity = resolveEventForwardIdentity(e, options.title)
    try {
      await e.bot.sendForwardMsg(e.contact, common.makeForward(messages, identity.id, identity.name), {
        source: options.title,
        summary: options.prompt,
        prompt: options.prompt,
        news: [{ text: '点击查看完整内容' }]
      })
      return
    } catch {
      // 部分适配器声明了 sendForwardMsg 但群里不可用，继续走兜底
    }
  }
  await options.fallback()
}

const sendImagesForward = async (e: Message, urls: string[], title: string) => {
  await sendForward(e, urls.map(url => [segment.image(url)]), {
    title,
    prompt: `查看 ${urls.length} 张图片`,
    fallback: async () => {
      for (const url of urls) await replyImage(e, url)
    }
  })
}

export const lightHandler = async (e: Message, next?: () => unknown) => {
  if (!isHiraAppEnabled()) return next?.()
  if (!Config.light.enabled) return next?.()
  const command = parseLightCommand(e.msg)
  if (command.type === 'none') return next?.()

  try {
    // 猫图/累了：先取图再发文案，接口全挂时只回一条报错，不会先抖机灵再报错
    if (command.type === 'cat') {
      const urls = await getCatImages(CAT_COUNT)
      if (urls.length === 0) throw new Error('猫图接口暂时不可用')
      await replyPlainText(e, '涩图也不看了，就看猫是吧')
      await sendImagesForward(e, urls, '猫图')
      return true
    }

    if (command.type === 'tired') {
      const urls = await getTiredImages()
      await replyPlainText(e, tiredPrompt)
      await sendImagesForward(e, urls, '累了')
      return true
    }

    if (command.type === 'buyerShow') {
      const result = await getBuyerShowImage()
      if (result.type === 'image') await replyImage(e, result.url, result.title)
      return true
    }

    const result = command.type === 'medicine'
      ? await queryMedicine(command.keyword)
      : await querySoftware(command.keyword)

    if (result.type === 'forward') {
      const { title, prompt, lines } = result
      await sendForward(e, lines.map(line => [segment.text(line)]), {
        title,
        prompt,
        fallback: async () => replyPlainText(e, lines.join('\n\n'))
      })
    } else if (result.type === 'image') {
      await replyImage(e, result.url, result.title)
    } else {
      await replyPlainText(e, `${result.title}\n${result.text}`)
    }
  } catch (error) {
    await replyPlainText(e, error instanceof Error ? error.message : String(error))
  }
  return true
}

export const light = karin.command(lightCommandReg, lightHandler, {
  name: 'Hira-轻量命令'
})
