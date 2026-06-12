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
}

export type ResolverFailure = {
  platform: ResolverPlatform
  displayName: string
  ok: false
  reason: string
}

export type ResolverResult = ResolvedPost | ResolverFailure
