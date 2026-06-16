export type ResolverPlatform =
  | 'bilibili'
  | 'douyin'
  | 'kuaishou'
  | 'weibo'
  | 'tieba'
  | 'xiaoheihe'
  | 'xiaohongshu'
  | 'general'

export type ResolverMatch = {
  platform: ResolverPlatform
  displayName: string
  url: string
}

export type ResolvedPost = {
  platform: ResolverPlatform
  displayName: string
  title?: string
  description?: string
  author?: string
  pageUrl?: string
  videos: string[]
  images: string[]
  extras?: ResolverExtras
}

export type RichContentBlock =
  | { type: 'text', text: string }
  | { type: 'image', url: string }

export type RichCommentBlock = {
  author: string
  replyTo?: string
  floor?: number
  location?: string
  time?: string
  text: string
  images: string[]
}

export type ResolverExtras = {
  contentBlocks?: RichContentBlock[]
  commentBlocks?: RichCommentBlock[]
  tags?: string[]
  coverUrl?: string
  authorAvatar?: string
  location?: string
  createdAt?: string | number
}

export type ResolverFailure = {
  platform: ResolverPlatform
  displayName: string
  ok: false
  reason: string
}

export type ResolverResult = ResolvedPost | ResolverFailure
