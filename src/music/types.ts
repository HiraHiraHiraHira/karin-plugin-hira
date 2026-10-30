export type MusicSource = 'netease' | 'qq' | 'kuwo' | 'kugou' | 'bilibili'

export type MusicSearchCommand = {
  type: 'search'
  keyword: string
  source?: MusicSource
  listMode: boolean
}

export type MusicSelectCommand = {
  type: 'select'
  index: number
}

export type MusicLyricsCommand = {
  type: 'lyrics'
  index?: number
}

export type MusicVoiceCommand = {
  type: 'voice'
  index?: number
  highQuality?: boolean
}

export type MusicBilibiliLinkCommand = {
  type: 'bilibiliLink'
  url: string
}

export type MusicDownloadCommand = {
  type: 'download'
}

/** QQ 音乐个性化歌单(每日推荐/个性电台/收藏/随机),需要配置 QQ Cookie. */
export type MusicPersonalizedKind = 'dailyRecommend' | 'radio' | 'favorites' | 'random'

export type MusicPersonalizedCommand = {
  type: MusicPersonalizedKind
  page?: number
}

export type MusicCommand =
  | MusicSearchCommand
  | MusicSelectCommand
  | MusicLyricsCommand
  | MusicVoiceCommand
  | MusicDownloadCommand
  | MusicBilibiliLinkCommand
  | MusicPersonalizedCommand
  | { type: 'nextPage' }
  | { type: 'none' }

export type MusicItem = {
  id: string
  source: MusicSource
  title: string
  artists: string[]
  album?: string
  durationSeconds?: number
  coverUrl?: string
  pageUrl: string
  raw?: unknown
}

export type MusicPlayable = {
  item: MusicItem
  audioUrl: string
  quality?: string
  expiresAt?: number
}

export type MusicProvider = {
  source: MusicSource
  search(keyword: string, page: number, pageSize: number): Promise<MusicItem[]>
  getPlayable(item: MusicItem): Promise<MusicPlayable>
  /** 单个 string 为一种歌词; 数组表示原文/翻译等多段, 发送侧逐段转发. */
  getLyrics?(item: MusicItem): Promise<string | string[] | undefined>
  /** 个性化歌单(目前仅 QQ 音乐实现). */
  getPersonalized?(kind: MusicPersonalizedKind, options?: { page?: number, pageSize?: number }): Promise<MusicItem[]>
}

export type MusicSessionMeta = {
  keyword: string
  source: MusicSource
  page: number
}
