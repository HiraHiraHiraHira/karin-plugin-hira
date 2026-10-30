import type { CustomNodeElement, Message, SendElement } from 'node-karin'
import { segment } from 'node-karin'

import { dedupeImageUrls, dedupeRichContentBlocks, type ImageDedupeOptions } from '@/resolvers/media'
import type { ResolvedPost, ResolverPlatform, RichCommentBlock, RichContentBlock } from '@/resolvers/types'
import { sendWithMediaRetry } from '@/services/mediaRetry'

export type ResolverForwardCopy = {
  contentPrompt: string
  commentPrompt: string
  commentUnit: string
}

export type ForwardIdentity = {
  id: string
  name: string
}

export const resolverForwardCopy = (post: Pick<ResolvedPost, 'platform' | 'displayName'>): ResolverForwardCopy => {
  const copies: Partial<Record<ResolverPlatform, ResolverForwardCopy>> = {
    xiaoheihe: { contentPrompt: '小黑盒帖子正文', commentPrompt: '小黑盒帖子评论', commentUnit: '评论' },
    xiaohongshu: { contentPrompt: '小红书笔记正文', commentPrompt: '小红书笔记评论', commentUnit: '评论' },
    weibo: { contentPrompt: '微博正文', commentPrompt: '微博评论', commentUnit: '评论' },
    tieba: { contentPrompt: '贴吧帖子正文', commentPrompt: '贴吧回复', commentUnit: '回复' }
  }
  return copies[post.platform] || {
    contentPrompt: `${post.displayName}正文`,
    commentPrompt: `${post.displayName}评论`,
    commentUnit: '评论'
  }
}

export const resolveEventForwardIdentity = (e: Message, fallbackName: string): ForwardIdentity => {
  const event = e as unknown as {
    userId?: string | number
    user_id?: string | number
    sender?: {
      userId?: string | number
      user_id?: string | number
      card?: string
      nickname?: string
    }
  }
  const id = event.sender?.userId || event.sender?.user_id || event.userId || event.user_id || e.selfId || ''
  const name = event.sender?.card || event.sender?.nickname || (id ? String(id) : fallbackName)
  return {
    id: String(id),
    name
  }
}

/**
 * 合并转发可用性探测: 适配器必须实现 sendForwardMsg, 且当前事件必须带得动 contact.
 * 真正的发送失败仍由调用方 catch 兜底为直发, 这里只挡掉必然失败的情况.
 */
export const canSendResolverForward = (e: Message) => {
  if (!e.contact) return false
  return typeof (e.bot as unknown as { sendForwardMsg?: unknown } | undefined)?.sendForwardMsg === 'function'
}

export const buildFakeForwardNode = (message: SendElement[], userId: string, nickname: string): CustomNodeElement => ({
  type: 'node',
  subType: 'fake',
  userId,
  nickname,
  message
})

export const richContentElements = (blocks: RichContentBlock[], options?: ImageDedupeOptions) => dedupeRichContentBlocks(blocks, options).map(block => (
  block.type === 'text' ? segment.text(block.text) : segment.image(block.url)
))

export const buildResolverContentNodes = (e: Message, post: ResolvedPost, blocks: RichContentBlock[], options?: ImageDedupeOptions) => {
  const identity = resolveEventForwardIdentity(e, post.displayName)
  return [buildFakeForwardNode(richContentElements(blocks, options), identity.id, identity.name)]
}

export const formatResolverCommentBlock = (comment: RichCommentBlock) => {
  const header = comment.replyTo ? `${comment.author} 回复 ${comment.replyTo}` : comment.author
  const meta = [
    typeof comment.floor === 'number' ? `${comment.floor}楼` : undefined,
    comment.location,
    comment.time,
    typeof comment.likeCount === 'number' && comment.likeCount > 0 ? `👍 ${comment.likeCount}` : undefined,
    typeof comment.replyCount === 'number' && comment.replyCount > 0 ? `💬 ${comment.replyCount}` : undefined
  ].filter(Boolean).join(' · ')
  return [header, meta, '', comment.text].filter((line, index) => line || index === 2).join('\n')
}

/**
 * 评论节点用触发者的 id 承载转发身份(避免出现灰头像), 昵称仍显示评论作者;
 * 作者信息已同时写在正文首行, 不会丢失.
 */
export const buildResolverCommentNodes = (comments: RichCommentBlock[], identity?: ForwardIdentity) => comments.map(comment => buildFakeForwardNode([
  segment.text(formatResolverCommentBlock(comment)),
  ...dedupeImageUrls(comment.images).map(url => segment.image(url))
], identity?.id || '', comment.author))

export const sendResolverForward = async (
  e: Message,
  post: ResolvedPost,
  nodes: CustomNodeElement[],
  prompt: string,
  summary: string
) => {
  await sendWithMediaRetry(
    payload => e.bot.sendForwardMsg(e.contact, payload, {
      source: post.displayName,
      summary,
      prompt,
      news: [{ text: '点击查看完整内容' }]
    }),
    nodes
  )
}
