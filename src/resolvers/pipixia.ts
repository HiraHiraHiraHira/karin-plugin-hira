import { fetchResolverText, resolveResolverRedirectUrl } from '@/services/resolverHttp'

import type { ResolvedPost, ResolverFailure, ResolverResult, RichCommentBlock, RichContentBlock } from './types'

/**
 * 皮皮虾原生解析：R utils/pipixia-scraper.js + tools.js 2904-2976。
 * 页面 `RENDER_DATA` 里同时有无水印视频（评论 item 的 video_high）、作者、互动数据和评论，
 * 拿不到或无视频时由调用方降级到第三方通用接口。
 */

const asObject = (value: unknown): Record<string, any> | undefined => (
  typeof value === 'object' && value !== null ? value as Record<string, any> : undefined
)

const firstString = (...values: unknown[]) => {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim()
    if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  }
  return undefined
}

const firstNumber = (...values: unknown[]) => {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) return value
    if (typeof value === 'string' && /^\d+$/.test(value.trim())) return Number.parseInt(value.trim(), 10)
  }
  return undefined
}

const urlListFirst = (value: unknown) => {
  const list = Array.isArray(asObject(value)?.url_list) ? asObject(value)?.url_list : []
  return firstString(asObject(list[0])?.url)
}

export const extractPipixiaItemId = (url: string) => url.match(/item\/(\d+)/)?.[1]

export const extractPipixiaRenderData = (html: string) => {
  const match = html.match(/<script id="RENDER_DATA" type="application\/json">([\s\S]+?)<\/script>/)
  if (!match?.[1]) return undefined
  try {
    return JSON.parse(decodeURIComponent(match[1])) as Record<string, any>
  } catch {
    return undefined
  }
}

const formatCommentTime = (seconds: unknown) => {
  const value = firstNumber(seconds)
  if (value === undefined) return undefined
  const date = new Date(value * 1000)
  if (Number.isNaN(date.getTime())) return undefined
  return date.toLocaleString('zh-CN')
}

const commentBlocksFrom = (cells: unknown): RichCommentBlock[] => {
  const list = Array.isArray(cells) ? cells : []
  return list.flatMap(cell => {
    const comment = asObject(asObject(cell)?.comment_info)
    const text = firstString(comment?.text)
    if (!comment || !text) return []

    const block: RichCommentBlock = {
      author: firstString(comment.user?.name, comment.user?.nickname) || '匿名用户',
      text,
      images: []
    }
    const likeCount = firstNumber(comment.digg_count)
    if (likeCount !== undefined) block.likeCount = likeCount
    const replyCount = firstNumber(comment.reply_count)
    if (replyCount !== undefined) block.replyCount = replyCount
    const time = formatCommentTime(comment.create_time)
    if (time) block.time = time
    return [block]
  })
}

/** 评论 item 的 video_high 才是无水印源；主 item 的 origin_video_download/video_download 是带水印降级。 */
const watermarkFreeVideo = (cells: unknown, item: Record<string, any>) => {
  const list = Array.isArray(cells) ? cells : []
  for (const cell of list) {
    const video = asObject(asObject(asObject(cell)?.comment_info)?.item)?.video
    const url = urlListFirst(video?.video_high)
    if (url) return url
  }
  return firstString(
    urlListFirst(item.video?.origin_video_download),
    urlListFirst(item.video?.video_download)
  )
}

const failure = (reason: string): ResolverFailure => ({
  platform: 'general',
  displayName: '皮皮虾',
  ok: false,
  reason
})

export const normalizePipixiaRenderData = (pageUrl: string, data: unknown): ResolvedPost | ResolverFailure => {
  const root = asObject(data)
  const item = asObject(root?.ppxItemDetail?.item)
  if (!item) return failure('皮皮虾页面缺少 item 数据')

  const cells = asObject(root?.ppxCellComment)?.cell_comments
  const videoUrl = watermarkFreeVideo(cells, item)
  if (!videoUrl) return failure('皮皮虾页面没有可用的视频直链')

  const author = asObject(item.author)
  const share = asObject(item.share)
  const inviter = firstString(root?.ppxUserDetail?.user?.name)
  let title = firstString(share?.title) || '皮皮虾视频'
  if (inviter && title.includes('的这个内容太有意思了')) {
    title = `这个内容太有意思了，${inviter}分享给你，快点开看看！`
  }

  const stats = asObject(item.stats)
  const statsLine = [
    stats?.like_count !== undefined ? `👍${stats.like_count}` : '',
    stats?.comment_count !== undefined ? `💬${stats.comment_count}` : '',
    stats?.share_count !== undefined ? `🔄${stats.share_count}` : '',
    stats?.play_count !== undefined ? `👁️${stats.play_count}` : ''
  ].filter(Boolean).join(' ')

  const cover = urlListFirst(item.cover)
  const description = [
    inviter ? `分享人：${inviter}` : '',
    statsLine ? `📊 数据：${statsLine}` : ''
  ].filter(Boolean).join('\n')

  const contentBlocks: RichContentBlock[] = []
  if (cover) contentBlocks.push({ type: 'image', url: cover })
  if (statsLine) contentBlocks.push({ type: 'text', text: `📊 数据：${statsLine}` })

  return {
    platform: 'general',
    displayName: '皮皮虾',
    title,
    description,
    author: firstString(author?.name),
    pageUrl,
    videos: [{ url: videoUrl }],
    images: cover ? [cover] : [],
    extras: {
      coverUrl: cover,
      authorAvatar: urlListFirst(author?.avatar),
      contentBlocks,
      commentBlocks: commentBlocksFrom(cells)
    }
  }
}

export const resolvePipixia = async (url: string): Promise<ResolverResult> => {
  try {
    const finalUrl = url.includes('/s/') ? await resolveResolverRedirectUrl(url) : url
    const itemId = extractPipixiaItemId(finalUrl)
    if (!itemId) return failure('无法从皮皮虾链接中提取 item_id')

    const html = await fetchResolverText(`https://h5.pipix.com/item/${itemId}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      }
    })
    const data = extractPipixiaRenderData(html)
    if (!data) return failure('皮皮虾页面未找到 RENDER_DATA')
    return normalizePipixiaRenderData(url, data)
  } catch (error) {
    return failure(error instanceof Error ? error.message : String(error))
  }
}
