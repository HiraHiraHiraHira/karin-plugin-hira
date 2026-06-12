import { Config } from '@/config'
import type { MusicProvider, MusicSource } from '@/music/types'

import { BilibiliMusicProvider } from './bilibili'
import { KugouProvider } from './kugou'
import { KuwoProvider } from './kuwo'
import { NeteaseProvider } from './netease'
import { QQProvider } from './qq'

export const createMusicProviders = () => {
  const music = Config.music
  const providers = new Map<MusicSource, MusicProvider>()

  providers.set('netease', new NeteaseProvider({
    baseUrl: music.api.neteaseBaseUrl,
    cookie: music.cookies.netease
  }))
  providers.set('qq', new QQProvider({ tempApi: music.api.qqTempApi, cookie: music.cookies.qq }))
  providers.set('kuwo', new KuwoProvider())
  providers.set('kugou', new KugouProvider())
  providers.set('bilibili', new BilibiliMusicProvider({ cookie: music.cookies.bilibili }))

  return providers
}

export { BilibiliMusicProvider }
