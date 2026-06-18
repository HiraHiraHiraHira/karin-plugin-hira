import { dedupeImageUrls, dedupeRichContentBlocks, imageQuality, normalizeMediaKey } from './media'
import type { ResolvedPost, RichMedia, RichResolvedPost } from './types'

const contentBlocksFor = (post: ResolvedPost) => {
  if (post.extras?.contentBlocks?.length) return dedupeRichContentBlocks(post.extras.contentBlocks)
  const blocks = []
  if (post.description?.trim()) blocks.push({ type: 'text' as const, text: post.description.trim() })
  for (const url of dedupeImageUrls(post.images)) blocks.push({ type: 'image' as const, url })
  return blocks
}

export const toRichResolvedPost = (post: ResolvedPost): RichResolvedPost => {
  const extras = post.extras || {}
  const media: RichMedia[] = []
  const seen = new Set<string>()
  const pushMedia = (item: RichMedia) => {
    const key = `${item.type}:${item.type === 'video' ? item.url : normalizeMediaKey(item.url)}`
    if (seen.has(key)) return
    seen.add(key)
    media.push(item)
  }

  if (extras.coverUrl) {
    pushMedia({
      type: 'cover',
      url: extras.coverUrl,
      quality: imageQuality(extras.coverUrl)
    })
  }

  const coverKey = extras.coverUrl ? normalizeMediaKey(extras.coverUrl) : ''
  for (const image of dedupeImageUrls(post.images)) {
    if (coverKey && normalizeMediaKey(image) === coverKey) continue
    pushMedia({
      type: 'image',
      url: image,
      quality: imageQuality(image)
    })
  }

  for (const video of post.videos) {
    pushMedia({
      type: 'video',
      url: video,
      source: 'native'
    })
  }

  return {
    platform: post.platform,
    displayName: post.displayName,
    pageUrl: post.pageUrl,
    author: post.author || extras.authorAvatar
      ? {
          name: post.author,
          avatar: extras.authorAvatar
        }
      : undefined,
    content: {
      title: post.title,
      summary: post.description,
      blocks: contentBlocksFor(post),
      createdAt: extras.createdAt,
      location: extras.location,
      tags: extras.tags
    },
    media,
    comments: extras.commentBlocks || [],
    source: {
      platform: post.platform,
      url: post.pageUrl
    }
  }
}
