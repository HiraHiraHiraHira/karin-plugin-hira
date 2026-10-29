import karin from 'node-karin'

import { isHiraAppEnabled } from '@/apps/runtime'
import { Config } from '@/config'
import { parseLightCommand } from '@/light/commandParser'
import { getBuyerShowImage, getCatImages, getTiredImage, queryMedicine, querySoftware } from '@/light/service'
import { replyImage, replyPlainText, replyText } from '@/services/message'

const CAT_COUNT = 10
/** 10 张一次性并发上传容易触发适配器限流, 3 张一批兼顾延迟与稳定 */
const CAT_SEND_CONCURRENCY = 3

const lightReg = /^#?(?:cat|买家秀|累了|医药查询\s+.+|推荐软件\s+.+)$/i

export const light = karin.command(lightReg, async (e, next) => {
  if (!isHiraAppEnabled()) return next?.()
  if (!Config.light.enabled) return next?.()
  const command = parseLightCommand(e.msg)
  if (command.type === 'none') return next?.()

  try {
    // 猫图：先取图再发文案，接口全挂时只回一条报错，不会先抖机灵再报错
    if (command.type === 'cat') {
      const urls = await getCatImages(CAT_COUNT)
      if (urls.length === 0) throw new Error('猫图接口暂时不可用')
      await replyPlainText(e, '涩图也不看了，就看猫是吧')
      for (let index = 0; index < urls.length; index += CAT_SEND_CONCURRENCY) {
        const chunk = urls.slice(index, index + CAT_SEND_CONCURRENCY)
        await Promise.allSettled(chunk.map((url, offset) => replyImage(e, url, index + offset === 0 ? '猫图' : undefined)))
      }
      return true
    }

    const result = command.type === 'buyerShow'
      ? await getBuyerShowImage()
      : command.type === 'tired'
        ? await getTiredImage()
        : command.type === 'medicine'
          ? await queryMedicine(command.keyword)
          : await querySoftware(command.keyword)

    if (result.type === 'image') await replyImage(e, result.url, result.title)
    else await replyText(e, `${result.title}\n${result.text}`)
  } catch (error) {
    await replyText(e, error instanceof Error ? error.message : String(error))
  }
  return true
}, {
  name: 'Hira-轻量命令'
})
