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

export type RichAuthor = {
  name?: string
  avatar?: string
  profileUrl?: string
  verified?: boolean
}

export type RichContent = {
  title?: string
  summary?: string
  blocks: RichContentBlock[]
  createdAt?: string | number
  location?: string
  tags?: string[]
}

export type RichMedia = {
  type: 'image' | 'video' | 'cover'
  url: string
  thumbnailUrl?: string
  width?: number
  height?: number
  source?: 'native' | 'fallback' | 'html' | 'api'
  quality?: 'original' | 'normal' | 'thumbnail' | 'blurred'
}

export type RichStats = Record<string, string | number | undefined>

export type RichComment = RichCommentBlock

export type RichSource = {
  platform: ResolverPlatform
  url?: string
}

export type RichFallback = {
  reason?: string
  message?: string
}

export type RichResolvedPost = {
  platform: ResolverPlatform
  displayName: string
  pageUrl?: string
  author?: RichAuthor
  content: RichContent
  media: RichMedia[]
  stats?: RichStats
  comments?: RichComment[]
  source?: RichSource
  fallback?: RichFallback
}

export type ResolverFailure = {
  platform: ResolverPlatform
  displayName: string
  ok: false
  reason: string
}

export type ResolverResult = ResolvedPost | ResolverFailure
