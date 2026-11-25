import type { CustomNodeElement, Message } from 'node-karin'
import { segment } from 'node-karin'

import { Config } from '@/config'
import { dedupeImageUrls, imageQuality, isUsableImageUrl } from '@/resolvers/media'
import type { ResolvedPost, ResolverFailure, ResolverResult } from '@/resolvers/types'
import {
  buildErrorCardHtml,
  buildResolverCardHtml,
  buildResolverPreviewCardHtml,
  logCardRenderFailure,
  renderCardImage
} from '@/services/cardRender'
import { sendWithMediaRetry } from '@/services/mediaRetry'
import { createReplyMusicList, nativeMusicCard, replyMusicPlayable, replyVoiceFileOrAudio } from '@/services/musicMessage'
import { inlinePreviewCover } from '@/services/previewCover'
import {
  buildFakeForwardNode,
  buildResolverCommentNodes,
  buildResolverContentNodes,
  canSendResolverForward,
  resolverForwardCopy,
  resolveEventForwardIdentity,
  sendResolverForward
} from '@/services/resolverForward'
import { createReplyResolverVideos, prepareResolverVideo } from '@/services/videoMessage'

type ReplyPayload = Parameters<Message['reply']>[0]

const resolverLongTextLength = 400
const prefix = () => Config.app.replyPrefix

export type ReplyHelperOptions = {
  /** 是否引用触发消息, 交互性回复默认引用 (node-karin 原生默认不引用). */
  reply?: boolean
  /** 发送后自动撤回的秒数, 用于语音上传占位等临时提示. */
  recallMsg?: number
}

const replyOptions = (options?: ReplyHelperOptions) => {
  const at = options?.reply === false ? { reply: false } : { reply: true }
  return options?.recallMsg ? { ...at, recallMsg: options.recallMsg } : at
}

export const replyText = async (e: Message, text: string, options?: ReplyHelperOptions) => {
  await e.reply(`${prefix()}：${text}` as ReplyPayload, replyOptions(options))
}

export const replyPlainText = async (e: Message, text: string, options?: ReplyHelperOptions) => {
  await e.reply(text as ReplyPayload, replyOptions(options))
}

export const replyImage = async (e: Message, url: string, title?: string) => {
  const elements = [
    title ? segment.text(`${prefix()}：${title}`) : undefined,
    segment.image(url)
  ].filter(Boolean)

  try {
    await sendWithMediaRetry(payload => e.reply(payload as ReplyPayload), elements)
  } catch {
    await replyText(e, `${title ? `${title}\n` : ''}${url}`)
  }
}

export { prepareResolverVideo }
export const replyResolverVideos = createReplyResolverVideos(replyText)

export { nativeMusicCard, replyMusicPlayable, replyVoiceFileOrAudio }
export const replyMusicList = createReplyMusicList(replyText)

// 兼容既有导出: 缓存扰动与重发逻辑已收拢到 services/mediaRetry, 其它调用方仍从这里取.
export { bustImageUrls, withCacheBuster } from '@/services/mediaRetry'

const isFailure = (result: ResolverResult): result is ResolverFailure => 'ok' in result && result.ok === false

const resolverCommentsEnabled = (resolverConfig = Config.resolver) => resolverConfig.commentsEnabled !== false

const canSendForward = canSendResolverForward

const resolvedPostText = (post: ResolvedPost) => {
  const title = post.title ? `，${post.title}` : ''
  return `识别：${post.displayName}${title}${post.description ? `\n${post.description}` : ''}${post.pageUrl ? `\n${post.pageUrl}` : ''}`
}

const resolverImageUrls = (images: string[], resolverConfig = Config.resolver) => {
  const media = resolverConfig.media
  if (media.dedupeImages !== false) {
    return dedupeImageUrls(images, {
      filterLowQuality: media.filterLowQualityImages !== false
    })
  }

  const urls = images.map(url => url.trim()).filter(Boolean)
  if (media.filterLowQualityImages === false) return urls
  const usable = urls.filter(isUsableImageUrl)
  if (usable.length > 0) return usable
  return urls.filter(url => imageQuality(url) !== 'blurred')
}

const resolverImageDedupeOptions = (resolverConfig = Config.resolver) => ({
  dedupe: resolverConfig.media.dedupeImages !== false,
  filterLowQuality: resolverConfig.media.filterLowQualityImages !== false
})

/** 转发按 50 条分批,超限分多条发出(参考 R sendImagesInBatches). */
const FORWARD_BATCH_SIZE = 50

const sendForwardBatched = async (e: Message, post: ResolvedPost, nodes: CustomNodeElement[], prompt: string, summary: string) => {
  for (let i = 0; i < nodes.length; i += FORWARD_BATCH_SIZE) {
    const chunk = nodes.slice(i, i + FORWARD_BATCH_SIZE)
    const suffix = nodes.length > FORWARD_BATCH_SIZE ? `(${Math.floor(i / FORWARD_BATCH_SIZE) + 1}/${Math.ceil(nodes.length / FORWARD_BATCH_SIZE)})` : ''
    await sendResolverForward(e, post, chunk, prompt, `${summary}${suffix}`)
  }
}

const directResolvedPost = async (e: Message, post: ResolvedPost, text: string, resolverConfig: typeof Config.resolver) => {
  const imageUrls = resolverImageUrls(post.images, resolverConfig).slice(0, 9)
  const elements = [
    segment.text(text),
    ...imageUrls.map(url => segment.image(url))
  ]
  try {
    await sendWithMediaRetry(payload => e.reply(payload as ReplyPayload), elements)
  } catch {
    await replyPlainText(e, [text, ...imageUrls].join('\n'))
  }
}

const cardResolvedPost = async (e: Message, post: ResolvedPost, text: string, resolverConfig: typeof Config.resolver) => {
  try {
    const images = await renderCardImage({
      name: `resolver-${post.platform}`,
      html: buildResolverCardHtml(post),
      width: 920
    })
    const elements = [
      ...images,
      ...resolverImageUrls(post.images, resolverConfig).slice(0, 9).map(url => segment.image(url))
    ]
    await sendWithMediaRetry(payload => e.reply(payload as ReplyPayload), elements)
  } catch (error) {
    logCardRenderFailure(`resolver-${post.platform}`, error)
    await directResolvedPost(e, post, text, resolverConfig)
  }
}

const richResolverPreviewCopy = (post: ResolvedPost) => {
  if (post.platform === 'bilibili') return '已识别B站视频，简介和视频将随后发送。'
  if (post.platform === 'kuaishou') return '已识别快手作品，完整内容将随后发送。'
  if (post.platform === 'xiaoheihe') return '已识别小黑盒分享，完整内容将随后发送。'
  if (post.platform === 'xiaohongshu') return '已识别小红书笔记，完整图文将随后发送。'
  if (post.platform === 'weibo') return '已识别微博分享，正文和评论将随后发送。'
  if (post.platform === 'tieba') return '已识别贴吧帖子，正文和回复将随后发送。'
  if (post.platform === 'general') return '已识别通用解析结果，内容将随后发送。'
  return `已识别${post.displayName}分享，完整内容将随后发送。`
}

const resolverPreviewCardPost = async (e: Message, post: ResolvedPost, text: string, resolverConfig: typeof Config.resolver) => {
  try {
    const renderPost = resolverConfig.media.inlinePreviewCover === false ? post : await inlinePreviewCover(post)
    const images = await renderCardImage({
      name: `resolver-${post.platform}-preview`,
      html: buildResolverPreviewCardHtml(renderPost, richResolverPreviewCopy(renderPost), {
        commentsEnabled: resolverCommentsEnabled(resolverConfig)
      }),
      width: 920
    })
    await sendWithMediaRetry(payload => e.reply(payload as ReplyPayload), images)
  } catch (error) {
    logCardRenderFailure(`resolver-${post.platform}-preview`, error)
    await directResolvedPost(e, post, text, resolverConfig)
  }
}

const replyResolvedPostForward = async (e: Message, post: ResolvedPost, text: string, resolverConfig: typeof Config.resolver) => {
  const identity = resolveEventForwardIdentity(e, post.displayName)
  const imageUrls = resolverImageUrls(post.images, resolverConfig)
  const nodes = [buildFakeForwardNode([
    segment.text(text),
    ...imageUrls.map(url => segment.image(url))
  ], identity.id, identity.name)]
  const isLongText = (post.description?.length || 0) > resolverLongTextLength
  const summary = imageUrls.length > 1
    ? `查看${imageUrls.length}张图片`
    : isLongText
      ? '查看完整解析内容'
      : '查看解析内容'

  await sendForwardBatched(e, post, nodes, `${post.displayName}解析结果`, summary)
}

const richResolverPlatforms = new Set<ResolvedPost['platform']>([
  'bilibili',
  'kuaishou',
  'xiaoheihe',
  'xiaohongshu',
  'weibo',
  'tieba',
  'general'
])

const hasRichResolverExtras = (post: ResolvedPost, resolverConfig: typeof Config.resolver) => (
  richResolverPlatforms.has(post.platform) &&
  Boolean(post.extras?.contentBlocks?.length || (resolverCommentsEnabled(resolverConfig) && post.extras?.commentBlocks?.length))
)

const replyRichResolverPost = async (e: Message, post: ResolvedPost, text: string, resolverConfig: typeof Config.resolver) => {
  await resolverPreviewCardPost(e, post, text, resolverConfig)
  if (!canSendForward(e)) {
    await directResolvedPost(e, post, text, resolverConfig)
    return
  }

  try {
    const copy = resolverForwardCopy(post)
    const contentBlocks = post.extras?.contentBlocks || []
    if (resolverConfig.sending.contentForwardEnabled !== false && contentBlocks.length > 0) {
      await sendForwardBatched(e, post, buildResolverContentNodes(e, post, contentBlocks, resolverImageDedupeOptions(resolverConfig)), copy.contentPrompt, '查看完整图文')
    }

    const commentBlocks = resolverCommentsEnabled(resolverConfig) ? post.extras?.commentBlocks || [] : []
    if (commentBlocks.length > 0) {
      const identity = resolveEventForwardIdentity(e, post.displayName)
      await sendForwardBatched(e, post, buildResolverCommentNodes(commentBlocks, identity), copy.commentPrompt, `查看${commentBlocks.length}条${copy.commentUnit}`)
    }
  } catch {
    await directResolvedPost(e, post, text, resolverConfig)
  }
}

export const replyResolvedPost = async (e: Message, result: ResolverResult) => {
  if (isFailure(result)) {
    try {
      const images = await renderCardImage({
        name: `resolver-error-${result.platform}`,
        html: buildErrorCardHtml({
          title: `${result.displayName}解析失败`,
          subtitle: result.displayName,
          reason: result.reason,
          suggestion: '可以检查 Cookie、代理和平台接口状态；渲染不可用时会自动退回文本提示。',
          details: [`platform=${result.platform}`]
        }),
        width: 920
      })
      await sendWithMediaRetry(payload => e.reply(payload as ReplyPayload), images)
    } catch (error) {
      logCardRenderFailure(`resolver-error-${result.platform}`, error)
      await replyPlainText(e, `${result.displayName}解析失败：${result.reason}`)
    }
    return
  }

  const resolverConfig = Config.resolver
  const post = result as ResolvedPost
  const text = resolvedPostText(post)
  if (hasRichResolverExtras(post, resolverConfig)) {
    await replyRichResolverPost(e, post, text, resolverConfig)
    await replyResolverVideos(e, post)
    return
  }

  const shouldForward = post.images.length > 1 || (post.description?.length || 0) > resolverLongTextLength

  if (shouldForward && canSendForward(e)) {
    try {
      await replyResolvedPostForward(e, post, text, resolverConfig)
    } catch {
      await directResolvedPost(e, post, text, resolverConfig)
    }
  } else {
    await cardResolvedPost(e, post, text, resolverConfig)
  }

  await replyResolverVideos(e, post)
}
