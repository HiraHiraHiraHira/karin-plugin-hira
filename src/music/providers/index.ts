import { Config } from '@/config'
import type { MusicProvider, MusicSource } from '@/music/types'

import { BilibiliMusicProvider, extractBvFromText } from './bilibili'
import { KugouProvider } from './kugou'
import { KuwoProvider } from './kuwo'
import { NeteaseProvider } from './netease'
import { QQProvider } from './qq'

let cachedFingerprint = ''
let cachedProviders: Map<MusicSource, MusicProvider> | undefined

export const createMusicProviders = () => {
  const music = Config.music
  const fingerprint = JSON.stringify({
    neteaseBaseUrl: music.api?.neteaseBaseUrl,
    qqTempApi: music.api?.qqTempApi,
    highQuality: music.highQuality,
    cookies: music.cookies,
    bilibili: music.bilibili
  })
  if (cachedProviders && cachedFingerprint === fingerprint) {
    return cachedProviders
  }

  const providers = new Map<MusicSource, MusicProvider>()

  providers.set('netease', new NeteaseProvider({
    baseUrl: music.api.neteaseBaseUrl,
    cookie: music.cookies.netease,
    highQuality: music.highQuality
  }))
  providers.set('qq', new QQProvider({ tempApi: music.api.qqTempApi, cookie: music.cookies.qq }))
  providers.set('kuwo', new KuwoProvider())
  providers.set('kugou', new KugouProvider())
  providers.set('bilibili', new BilibiliMusicProvider({
    cookie: music.cookies.bilibili,
    appKey: music.bilibili.appKey,
    appSecret: music.bilibili.appSecret
  }))

  cachedFingerprint = fingerprint
  cachedProviders = providers
  return providers
}

export { BilibiliMusicProvider, extractBvFromText }
