import karin from 'node-karin'

import { handleMusicMessage } from '@/music/controller'
import { handleMusicCookieMessage } from '@/music/cookieController'

export const musicReg = /^(?!#?(?:(?:点歌|音乐)(?:ck|cookie)(?:检查|状态)|提交(?:音乐|点歌)(?:ck|cookie)(?:\s|$)))(#?(?:多选)?(?:网易云?|QQ|qq|扣扣|酷我|酷狗|哔哩哔哩|哔哩|B站|bilibili)?(?:多选)?(?:点歌|点播音乐|点播|播放|放一首|放首|来一首|来首)\s*\S[\s\S]*|#?(?:听|播放)?[1-9]\d*|#?下一页|#?歌词\s*[1-9]\d*|#?(?:高清)?语音\s*[1-9]\d*|#?音乐\s+https?:\/\/[^\s]+)$/i
export const musicCookieReg = /^#?(?:提交(?:音乐|点歌)(?:ck|cookie)\s+\S+\s+[\s\S]+|(?:点歌|音乐)(?:ck|cookie)(?:检查|状态))$/i

export const musicCookie = karin.command(musicCookieReg, handleMusicCookieMessage, {
  name: 'Hira-音乐Cookie',
  priority: 690
})

export const music = karin.command(musicReg, handleMusicMessage, {
  name: 'Hira-点歌',
  priority: 700
})
