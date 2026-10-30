import karin from 'node-karin'

import { handleMusicMessage } from '@/music/controller'
import { handleMusicCookieMessage } from '@/music/cookieController'

const sourceWords = '网易云?|QQ|qq|扣扣|酷我|酷狗|哔哩哔哩|哔哩|B站|bilibili'
const actionWords = '点歌|点播音乐|点播|播放|放一首|放首|来一首|来首'
const personalizedWords = '每日推荐|每日30首|日推|个性电台|我的收藏|我喜欢的歌'
const commandPrefix = '#?(?:多选)?(?:' + sourceWords + ')?(?:多选)?'

const cookieCommand = '#?(?:(?:点歌|音乐)(?:ck|cookie)(?:检查|状态)|提交(?:音乐|点歌)(?:ck|cookie))'

/**
 * 命令门禁. 与 commandParser 保持一致:
 * - 序号(歌词/语音/下载音乐)可省略, 省略时取上次选中/首项(云崽行为);
 * - 搜索关键词允许为空, 由处理器回用法说明;
 * - 新增 QQ 个性化歌单命令;
 * - 排除 cookie 管理命令, 交给 musicCookieReg.
 */
export const musicReg = new RegExp(
  `^(?!${cookieCommand})` +
  `(${commandPrefix}(?:${actionWords})\\s*[\\s\\S]*` +
  `|#?(?:听|播放)?[1-9]\\d*` +
  '|#?下一页' +
  '|#?歌词\\s*(?:[1-9]\\d*)?' +
  '|#?(?:高清)?语音\\s*(?:[1-9]\\d*)?' +
  '|#?下载音乐\\s*(?:[1-9]\\d*)?' +
  '|#?音乐\\s+https?:\\/\\/[^\\s]+' +
  `|${commandPrefix}(?:${personalizedWords})\\s*\\d*)$`,
  'i'
)
export const musicCookieReg = new RegExp(`^${cookieCommand}[\\s\\S]*$`, 'i')

export const musicCookie = karin.command(musicCookieReg, handleMusicCookieMessage, {
  name: 'Hira-音乐Cookie'
})

export const music = karin.command(musicReg, handleMusicMessage, {
  name: 'Hira-点歌'
})
