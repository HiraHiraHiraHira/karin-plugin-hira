import karin from 'node-karin'

import { Config } from '@/config'
import { parseLightCommand } from '@/light/commandParser'
import { getBuyerShowImage, getCatImage, getTiredImage, queryMedicine, querySoftware } from '@/light/service'
import { replyImage, replyText } from '@/services/message'

const lightReg = /^#?(?:cat|买家秀|累了|医药查询\s+.+|推荐软件\s+.+)$/i

export const light = karin.command(lightReg, async (e, next) => {
  if (!Config.light.enabled) return next?.()
  const command = parseLightCommand(e.msg)
  if (command.type === 'none') return next?.()

  try {
    const result = command.type === 'cat'
      ? await getCatImage()
      : command.type === 'buyerShow'
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
  name: 'Hira-轻量命令',
  priority: 680
})
