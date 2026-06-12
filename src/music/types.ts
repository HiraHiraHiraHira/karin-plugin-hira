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

export type MusicCommand =
  | MusicSearchCommand
  | MusicSelectCommand
  | MusicLyricsCommand
  | MusicVoiceCommand
  | MusicBilibiliLinkCommand
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
  getLyrics?(item: MusicItem): Promise<string | undefined>
}

export type MusicSessionMeta = {
  keyword: string
  source: MusicSource
  page: number
}
