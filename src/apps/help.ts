import karin from 'node-karin'
import type { Message } from 'node-karin'

import { Config } from '@/config'
import { createConfiguredCommandRegExp, isHiraAppEnabled } from '@/apps/runtime'
import { buildHelpCardHtml, logCardRenderFailure, renderCardImage } from '@/services/cardRender'
import { replyPlainText } from '@/services/message'

export const helpReg = createConfiguredCommandRegExp(Config.app.helpCommand, ['hira\\s*帮助', 'hi\\s*帮助'])

type ReplyPayload = Parameters<Message['reply']>[0]

export const helpMenu = [
  {
    title: '常用功能',
    items: [
      { title: '自动识别分享链接', description: '按配置解析支持的平台链接。', icon: '↗' },
      { title: '#hi状态 / #Hira状态', description: '查看功能开关、兼容模式和运行信息。', icon: 'S' }
    ]
  },
  {
    title: '点歌',
    items: [
      { title: '#点歌 <关键词>', description: '使用默认音乐源点歌。', icon: '♪' },
      { title: '#网易点歌 / #QQ点歌 / #酷我点歌 / #酷狗点歌 <关键词>', description: '指定音乐源搜索。', icon: '源' },
      { title: '#多选点歌 <关键词>', description: '返回列表后发送序号选择，#下一页 翻页。', icon: '列' },
      { title: '#歌词 / #语音 / 音乐 <B站链接>', description: '歌词、语音和 B站音乐链接。', icon: '声' },
      { title: '#提交音乐ck <源> <cookie>', description: '提交音乐 Cookie；#点歌ck检查 查看状态。', icon: 'CK' }
    ]
  },
  {
    title: '多平台解析',
    items: [
      { title: '微博 / 贴吧 / 小黑盒 / 通用小平台', description: '默认补足 KKK 之外的平台解析。', icon: '解' },
      { title: '多图 / 长文 / 视频', description: '多图长文以合并聊天记录展示，视频按配置下载发送。', icon: '媒' }
    ],
    subGroups: [
      {
        title: '关闭 KKK 兼容模式后接管',
        items: [
          { title: 'B站 / 抖音 / 快手 / 小红书', description: '由 Hira 尝试完整解析并按配置下载视频。', icon: '接' }
        ]
      }
    ]
  },
  {
    title: '轻量与 AI',
    items: [
      { title: '#cat / #买家秀 / #累了', description: '轻量娱乐命令。', icon: '玩' },
      { title: '#医药查询 / #推荐软件', description: '常用查询命令。', icon: '?' },
      { title: '翻中 / 翻英 / 翻日 <文本>', description: '文本翻译。', icon: '译' },
      { title: '#总结一下 <链接>', description: '网页总结，需要先启用并配置 API Key。', icon: 'AI' }
    ]
  },
  {
    title: '管理',
    items: [
      { title: '#Hira更新 / #hi更新', description: '检查插件更新，更新成功后自动重启 Karin。', icon: '更' },
      { title: '#hi清理垃圾 / #Hira清理垃圾', description: '清理下载和渲染临时文件。', icon: '清' }
    ]
  }
]

export const helpFallbackText = () => [
  '插件帮助',
  '',
  ...helpMenu.flatMap(group => [
    group.title,
    ...group.items.map(item => `${item.title} | ${item.description}`),
    ''
  ]),
  '默认不包含未列出的第三方平台功能。'
].join('\n').trim()

export const replyHelp = async (e: Message) => {
  try {
    const images = await renderCardImage({
      name: 'help',
      html: buildHelpCardHtml(helpMenu),
      width: 920
    })
    await e.reply(images as ReplyPayload)
  } catch (error) {
    logCardRenderFailure('help', error)
    await replyPlainText(e, helpFallbackText())
  }
}

export const help = karin.command(helpReg, async (e, next) => {
  if (!isHiraAppEnabled()) return next?.()
  await replyHelp(e)
  return true
}, {
  name: 'Hira-帮助'
})
