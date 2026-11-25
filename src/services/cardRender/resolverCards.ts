import { dedupeImageUrls, isUsableImageUrl, selectBestImageUrl } from '@/resolvers/media'
import type { ResolvedPost } from '@/resolvers/types'

import { renderTemplateHtml } from './templates'
import { compactText, escapeHtml, type ResolverPreviewCardOptions } from './types'

const mediaCount = (items: unknown[] | undefined) => Array.isArray(items) ? items.length : 0

const metricCard = (label: string, value: string | number) => `
  <article class="metric-card">
    <div class="metric-label">${escapeHtml(label)}</div>
    <div class="metric-value">${escapeHtml(value)}</div>
  </article>`

const resolverCountText = (value: number, unit: string) => value > 0 ? `${value} ${unit}` : ''

const stripResolverCommentSections = (value: string) => (
  value
    .replace(/\n\n热门(?:评论|回复)\n[\s\S]*$/u, '')
    .trim()
)

const resolverPreviewDocument = (body: string, width = 920) => `<!doctype html>
<html lang="zh-CN">
<head style="display:none!important">
<meta charset="utf-8">
<meta name="viewport" content="width=${width}, initial-scale=1">
<style style="display:none!important">
* { box-sizing: border-box; }
html {
  background: #f4f4f5;
}
body {
  margin: 0;
  width: ${width}px;
  background: #f4f4f5;
  color: #18181b;
  font-family: HarmonyOSHans-Regular, "HarmonyOS Sans SC", "Microsoft YaHei", "PingFang SC", Arial, sans-serif;
}
#container {
  width: ${width}px;
  padding: 8px;
  background: #f4f4f5;
}
.resolver-preview-shell {
  width: 100%;
  min-height: 360px;
  padding: 20px;
  border-radius: 8px;
  background: #fff;
  border: 1px solid rgba(24, 24, 27, 0.08);
  box-shadow: none;
  overflow: hidden;
}
.resolver-preview-topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 18px;
}
.resolver-preview-brand {
  display: flex;
  align-items: center;
  gap: 8px;
  color: #52525b;
  font-size: 13px;
  line-height: 1.35;
  font-weight: 850;
}
.resolver-preview-brand-dot {
  width: 9px;
  height: 9px;
  border-radius: 999px;
  background: var(--resolver-accent, #22c55e);
}
.resolver-preview-source {
  color: #a1a1aa;
  font-size: 12px;
  line-height: 1.35;
  font-weight: 800;
}
.resolver-preview-main {
  display: grid;
  grid-template-columns: 168px 1fr;
  gap: 20px;
  align-items: start;
}
.resolver-preview-main-no-cover {
  display: block;
}
.resolver-preview-cover {
  width: 168px;
  height: 168px;
  border-radius: 8px;
  object-fit: cover;
  background: #f4f4f5;
}
.resolver-preview-title {
  margin: 0;
  color: #18181b;
  font-size: 30px;
  line-height: 1.22;
  font-weight: 900;
  letter-spacing: 0;
  overflow-wrap: anywhere;
}
.resolver-preview-author {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 13px;
}
.resolver-preview-avatar,
.resolver-preview-avatar-fallback {
  flex: 0 0 auto;
  width: 36px;
  height: 36px;
  border-radius: 999px;
}
.resolver-preview-avatar {
  object-fit: cover;
  background: #f4f4f5;
}
.resolver-preview-avatar-fallback {
  display: grid;
  place-items: center;
  background: color-mix(in srgb, var(--resolver-accent, #22c55e) 14%, white);
  color: var(--resolver-accent-strong, #14532d);
  font-size: 14px;
  font-weight: 900;
}
.resolver-preview-author-name {
  color: #27272a;
  font-size: 14px;
  line-height: 1.35;
  font-weight: 850;
}
.resolver-preview-author-meta {
  margin-top: 2px;
  color: #71717a;
  font-size: 12px;
  line-height: 1.35;
  font-weight: 650;
}
.resolver-preview-desc {
  margin: 16px 0 0;
  color: #3f3f46;
  font-size: 16px;
  line-height: 1.68;
  font-weight: 520;
  white-space: pre-line;
  overflow-wrap: anywhere;
}
.resolver-preview-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
  margin-top: 15px;
}
.resolver-preview-chip {
  padding: 5px 9px;
  border-radius: 8px;
  background: color-mix(in srgb, var(--resolver-accent, #22c55e) 9%, #f4f4f5);
  color: #3f3f46;
  font-size: 12px;
  line-height: 1.35;
  font-weight: 800;
}
.resolver-preview-divider {
  height: 1px;
  margin: 20px 0 14px;
  background: #e4e4e7;
}
.resolver-preview-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}
.resolver-preview-stats {
  display: flex;
  flex-wrap: wrap;
  gap: 14px;
  color: #71717a;
  font-size: 13px;
  line-height: 1.35;
  font-weight: 800;
}
.resolver-preview-mark {
  color: #d4d4d8;
  font-size: 11px;
  line-height: 1.35;
  font-weight: 850;
}
</style>
</head>
<body>
${body}
</body>
</html>`

const resolverPlatformTones: Partial<Record<ResolvedPost['platform'], { accent: string, strong: string }>> = {
  bilibili: { accent: '#00a1d6', strong: '#0369a1' },
  kuaishou: { accent: '#ff5f00', strong: '#c2410c' },
  xiaoheihe: { accent: '#16a34a', strong: '#14532d' },
  xiaohongshu: { accent: '#e11d48', strong: '#9f1239' },
  weibo: { accent: '#f59e0b', strong: '#92400e' },
  tieba: { accent: '#2563eb', strong: '#1e40af' },
  general: { accent: '#64748b', strong: '#334155' }
}

const resolverPlatformTone = (platform: ResolvedPost['platform']) => (
  resolverPlatformTones[platform] || { accent: '#2563eb', strong: '#1e40af' }
)

const resolverPreviewCover = (post: ResolvedPost) => {
  const cover = selectBestImageUrl([post.extras?.coverUrl, ...post.images])
  return cover && isUsableImageUrl(cover) ? cover : undefined
}

const avatarInitial = (author: string) => author.trim().slice(0, 1) || '?'

export const buildResolverPreviewCardHtml = (post: ResolvedPost, defaultDescription?: string, options: ResolverPreviewCardOptions = {}) => {
  const extras = post.extras || {}
  const commentsEnabled = options.commentsEnabled ?? true
  const cover = resolverPreviewCover(post)
  const tags = (extras.tags || []).slice(0, 4)
  const title = compactText(post.title || post.displayName, 58)
  const rawDescription = commentsEnabled ? post.description : stripResolverCommentSections(post.description || '')
  const description = compactText(rawDescription || defaultDescription || `已识别${post.displayName}分享，完整内容将随后发送。`, 150)
  const author = post.author || post.displayName
  const avatarText = avatarInitial(author)
  const meta = [extras.location, extras.createdAt ? String(extras.createdAt) : undefined].filter(Boolean).join(' · ')
  const images = dedupeImageUrls(post.images)
  const stats = [
    resolverCountText(mediaCount(images), '张图片'),
    resolverCountText(mediaCount(post.videos), '个视频'),
    commentsEnabled ? resolverCountText(mediaCount(extras.commentBlocks), '条评论') : ''
  ].filter(Boolean)
  const tone = resolverPlatformTone(post.platform)

  return resolverPreviewDocument(`
    <main id="container">
      <article class="resolver-preview-shell" data-platform="${escapeHtml(post.platform)}" style="--resolver-accent: ${tone.accent}; --resolver-accent-strong: ${tone.strong};">
        <header class="resolver-preview-topbar">
          <div class="resolver-preview-brand"><span class="resolver-preview-brand-dot"></span>${escapeHtml(post.displayName)}</div>
          <div class="resolver-preview-source">Hira Resolver</div>
        </header>
        <section class="${cover ? 'resolver-preview-main' : 'resolver-preview-main-no-cover'}">
          ${cover ? `<img class="resolver-preview-cover" src="${escapeHtml(cover)}" alt="">` : ''}
          <div class="resolver-preview-content">
            <h1 class="resolver-preview-title">${escapeHtml(title)}</h1>
            <div class="resolver-preview-author">
              ${extras.authorAvatar
                ? `<img class="resolver-preview-avatar" src="${escapeHtml(extras.authorAvatar)}" alt="">`
                : `<div class="resolver-preview-avatar-fallback">${escapeHtml(avatarText)}</div>`}
              <div>
                <div class="resolver-preview-author-name">${escapeHtml(author)}</div>
                ${meta ? `<div class="resolver-preview-author-meta">${escapeHtml(meta)}</div>` : ''}
              </div>
            </div>
            <p class="resolver-preview-desc">${escapeHtml(description)}</p>
            ${tags.length > 0
              ? `<div class="resolver-preview-chips">${tags.map(tag => `<span class="resolver-preview-chip">#${escapeHtml(tag)}</span>`).join('')}</div>`
              : ''}
          </div>
        </section>
        ${stats.length > 0 ? `
        <div class="resolver-preview-divider"></div>
        <footer class="resolver-preview-footer">
          <div class="resolver-preview-stats">${stats.map(item => `<span>${escapeHtml(item)}</span>`).join('')}</div>
          <div class="resolver-preview-mark">karin-plugin-hira</div>
        </footer>` : ''}
      </article>
    </main>`)
}

export const buildXiaoheihePreviewCardHtml = (post: ResolvedPost, options?: ResolverPreviewCardOptions) => (
  buildResolverPreviewCardHtml(post, '已识别小黑盒分享，完整内容将随后发送。', options)
)

export const buildXiaohongshuPreviewCardHtml = (post: ResolvedPost, options?: ResolverPreviewCardOptions) => (
  buildResolverPreviewCardHtml(post, '已识别小红书笔记，完整图文将随后发送。', options)
)

export const buildResolverCardHtml = (post: ResolvedPost) => {
  const title = post.title || `${post.displayName}解析结果`
  const description = post.description ? compactText(post.description, 260) : '已识别分享链接，媒体内容将随卡片一并发送'

  return renderTemplateHtml({
    eyebrow: 'RESOLVER RESULT',
    hero: 'RESOLVE',
    title: '解析结果',
    subtitle: post.displayName,
    watermark: 'POST',
    footer: 'Generated by karin-plugin-hira',
    body: `
      <section class="resolver-card">
        <div class="resolver-summary">
          <div class="resolver-platform">${escapeHtml(post.displayName)}</div>
          <h2 class="resolver-title">${escapeHtml(compactText(title, 72))}</h2>
          ${post.author ? `<p class="resolver-author">作者：${escapeHtml(post.author)}</p>` : ''}
          <p class="resolver-desc">${escapeHtml(description)}</p>
          ${post.pageUrl ? `<p class="resolver-url">${escapeHtml(post.pageUrl)}</p>` : ''}
        </div>
        <div class="resolver-metrics">
          ${metricCard('平台', post.platform)}
          ${metricCard('图片', mediaCount(post.images))}
          ${metricCard('视频', mediaCount(post.videos))}
        </div>
      </section>`
  })
}
