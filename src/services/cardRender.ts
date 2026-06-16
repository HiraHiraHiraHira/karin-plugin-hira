import fs from 'node:fs'
import crypto from 'node:crypto'
import path from 'node:path'

import type { ImageElement } from 'node-karin'
import { karinPathHtml, logger, render as karinRender, segment } from 'node-karin'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import type { ResolvedPost } from '@/resolvers/types'
import { Root } from '@/root'

export type HelpCardItem = {
  title: string
  description: string
  icon?: string
}

export type HelpCardGroup = {
  title: string
  items: HelpCardItem[]
  subGroups?: Array<{
    title: string
    items: HelpCardItem[]
  }>
}

export type MusicListCardItem = {
  title: string
  artists: string
  duration?: string
}

export type StatusCardItem = {
  label: string
  value: string
  detail?: string
  status?: 'ok' | 'off' | 'warn' | 'info'
}

export type StatusCardOptions = {
  title: string
  subtitle?: string
  eyebrow?: string
  items: StatusCardItem[]
  footer?: string
}

export type TemplateHtmlOptions = {
  hero: string
  eyebrow: string
  title: string
  subtitle?: string
  watermark?: string
  body: string
  footer?: string
  width?: number
}

export type ErrorCardOptions = {
  title: string
  subtitle?: string
  reason: string
  suggestion?: string
  details?: string[]
}

export type ResolverPreviewCardOptions = {
  commentsEnabled?: boolean
}

type RenderOptions = {
  name: string
  html: string
  width?: number
  writeHtml?: (html: string, name: string) => string
  render?: (options: Record<string, unknown>) => Promise<string | string[]>
}

const escapeHtml = (value: string | number | undefined) => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;')

const compactText = (value: string, maxLength: number) => {
  const text = value.replace(/\s+/g, ' ').trim()
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}...` : text
}

const iconText = (item: HelpCardItem) => compactText(item.icon || item.title.replace(/^#?/, '').trim().slice(0, 2) || '?', 2)

const createDocument = (body: string, width = 920) => `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=${width}, initial-scale=1">
<style>
* { box-sizing: border-box; }
:root {
  --hira-bg: #f7f8fb;
  --hira-fg: #131822;
  --hira-muted: #687386;
  --hira-border: rgba(28, 36, 52, 0.13);
  --hira-surface: rgba(255, 255, 255, 0.72);
  --hira-surface-strong: rgba(255, 255, 255, 0.9);
  --hira-blue: #2563eb;
  --hira-violet: #7c3aed;
  --hira-teal: #0d9488;
  --hira-pink: #f31260;
  --hira-amber: #d97706;
}
body {
  margin: 0;
  width: ${width}px;
  background: transparent;
  color: var(--hira-fg);
  font-family: HarmonyOSHans-Regular, "HarmonyOS Sans SC", "Microsoft YaHei", "PingFang SC", Arial, sans-serif;
}
#container {
  width: ${width}px;
  padding: 24px;
}
.hira-render-shell {
  position: relative;
  width: 100%;
  min-height: 360px;
  border-radius: 8px;
  background:
    linear-gradient(135deg, rgba(37, 99, 235, 0.12) 0%, transparent 28%),
    linear-gradient(225deg, rgba(243, 18, 96, 0.09) 0%, transparent 30%),
    linear-gradient(180deg, rgba(255, 255, 255, 0.96) 0%, rgba(241, 245, 249, 0.96) 100%);
  border: 1px solid var(--hira-border);
  box-shadow: 0 22px 60px rgba(15, 23, 42, 0.18);
  overflow: hidden;
}
.hira-render-shell::before {
  content: "";
  position: absolute;
  inset: 0;
  pointer-events: none;
  opacity: 0.16;
  background-image:
    linear-gradient(rgba(19, 24, 34, 0.08) 1px, transparent 1px),
    linear-gradient(90deg, rgba(19, 24, 34, 0.08) 1px, transparent 1px);
  background-size: 38px 38px;
  mask-image: linear-gradient(180deg, black 0%, transparent 78%);
}
.hira-render-shell::after {
  content: "";
  position: absolute;
  left: -80px;
  right: -80px;
  bottom: -120px;
  height: 220px;
  pointer-events: none;
  opacity: 0.08;
  transform: rotate(-7deg);
  background: repeating-linear-gradient(90deg, var(--hira-fg) 0 8px, transparent 8px 18px);
}
.render-content {
  position: relative;
  z-index: 1;
  padding: 36px 42px 32px;
}
.render-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-end;
  gap: 24px;
  padding-bottom: 18px;
  border-bottom: 3px solid rgba(19, 24, 34, 0.09);
}
.system-line {
  display: flex;
  align-items: center;
  gap: 9px;
  margin-bottom: 8px;
  color: var(--hira-muted);
  font-family: Consolas, "JetBrains Mono", monospace;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0;
}
.system-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--hira-blue);
  box-shadow: 0 0 0 5px rgba(37, 99, 235, 0.12);
}
.hero-word {
  margin: 0;
  color: var(--hira-fg);
  font-size: 62px;
  line-height: 0.95;
  font-weight: 900;
  letter-spacing: 0;
}
.module-meta {
  min-width: 230px;
  text-align: right;
  padding-bottom: 4px;
}
.header-label {
  display: block;
  margin-bottom: 5px;
  color: var(--hira-muted);
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0;
}
.module-title {
  color: var(--hira-fg);
  font-size: 21px;
  line-height: 1.25;
  font-weight: 800;
}
.module-subtitle {
  margin-top: 6px;
  color: var(--hira-muted);
  font-size: 13px;
  line-height: 1.5;
}
.guide-watermark {
  position: absolute;
  top: 74px;
  right: 26px;
  color: rgba(19, 24, 34, 0.035);
  font-size: 128px;
  line-height: 1;
  font-weight: 900;
  letter-spacing: 0;
  writing-mode: vertical-rl;
  user-select: none;
}
.corner-code {
  position: absolute;
  top: 22px;
  right: 26px;
  color: rgba(19, 24, 34, 0.28);
  font-family: Consolas, "JetBrains Mono", monospace;
  font-size: 10px;
  letter-spacing: 0;
}
.dot-matrix {
  position: absolute;
  top: 24px;
  left: 24px;
  display: grid;
  grid-template-columns: repeat(4, 5px);
  gap: 6px;
  opacity: 0.2;
}
.dot-matrix span {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--hira-fg);
}
.section-list {
  display: grid;
  gap: 28px;
  margin-top: 30px;
  padding-bottom: 12px;
}
.command-section {
  position: relative;
}
.section-heading {
  display: flex;
  align-items: center;
  gap: 15px;
  margin: 0 0 16px;
}
.section-bar {
  width: 6px;
  height: 46px;
  border-radius: 6px;
  background: var(--section-color, var(--hira-blue));
}
.section-title {
  margin: 0;
  color: var(--hira-fg);
  font-size: 35px;
  line-height: 1;
  font-weight: 900;
  letter-spacing: 0;
}
.subgroup-title {
  display: flex;
  align-items: center;
  gap: 9px;
  margin: 20px 0 12px;
  color: rgba(19, 24, 34, 0.62);
  font-size: 16px;
  line-height: 1.35;
  font-weight: 800;
  letter-spacing: 0;
}
.subgroup-title::before {
  content: "";
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: currentColor;
}
.command-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  column-gap: 24px;
  row-gap: 15px;
}
.command-item {
  display: flex;
  gap: 14px;
  min-height: 92px;
  padding: 14px;
  border-radius: 8px;
  background: var(--hira-surface);
  border: 1px solid var(--hira-border);
  backdrop-filter: blur(18px);
}
.command-icon {
  display: grid;
  place-items: center;
  flex: 0 0 auto;
  width: 42px;
  height: 42px;
  border-radius: 8px;
  color: var(--section-color, var(--hira-blue));
  background: color-mix(in srgb, var(--section-color, var(--hira-blue)) 12%, white);
  border: 1px solid color-mix(in srgb, var(--section-color, var(--hira-blue)) 24%, transparent);
  font-size: 18px;
  font-weight: 900;
  line-height: 1;
}
.command-body {
  min-width: 0;
}
.command-title {
  margin: 0 0 7px;
  color: var(--hira-fg);
  font-size: 19px;
  line-height: 1.28;
  font-weight: 900;
  letter-spacing: 0;
  overflow-wrap: anywhere;
}
.command-desc {
  margin: 0;
  color: var(--hira-muted);
  font-size: 14px;
  line-height: 1.55;
  font-weight: 500;
  letter-spacing: 0;
  white-space: pre-line;
}
.music-list {
  display: grid;
  gap: 12px;
  margin-top: 28px;
}
.music-row {
  display: grid;
  grid-template-columns: 58px 1fr auto;
  align-items: center;
  gap: 16px;
  min-height: 76px;
  padding: 14px 18px;
  border-radius: 8px;
  background: var(--hira-surface-strong);
  border: 1px solid var(--hira-border);
}
.music-index {
  display: grid;
  place-items: center;
  width: 44px;
  height: 44px;
  border-radius: 8px;
  background: #111827;
  color: #fff;
  font-family: Consolas, "JetBrains Mono", monospace;
  font-size: 19px;
  font-weight: 900;
  letter-spacing: 0;
}
.song-main {
  min-width: 0;
}
.song-title {
  margin: 0 0 5px;
  color: var(--hira-fg);
  font-size: 21px;
  line-height: 1.25;
  font-weight: 900;
  letter-spacing: 0;
  overflow-wrap: anywhere;
}
.song-artists {
  margin: 0;
  color: var(--hira-muted);
  font-size: 14px;
  line-height: 1.35;
  letter-spacing: 0;
  overflow-wrap: anywhere;
}
.duration {
  padding: 6px 10px;
  border-radius: 8px;
  background: rgba(124, 58, 237, 0.09);
  color: #5b21b6;
  font-family: Consolas, "JetBrains Mono", monospace;
  font-size: 14px;
  font-weight: 800;
  letter-spacing: 0;
}
.card-tip {
  margin: 16px 0 0;
  padding: 12px 14px;
  border-radius: 8px;
  background: rgba(13, 148, 136, 0.08);
  border: 1px solid rgba(13, 148, 136, 0.16);
  color: #0f766e;
  font-size: 14px;
  line-height: 1.5;
  font-weight: 700;
  letter-spacing: 0;
}
.status-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px;
  margin-top: 28px;
}
.status-item {
  min-height: 118px;
  padding: 16px;
  border-radius: 8px;
  background: var(--hira-surface-strong);
  border: 1px solid var(--hira-border);
}
.status-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
}
.status-label {
  color: var(--hira-muted);
  font-size: 13px;
  line-height: 1.4;
  font-weight: 800;
}
.status-pill {
  flex: 0 0 auto;
  min-width: 44px;
  padding: 4px 8px;
  border-radius: 8px;
  text-align: center;
  font-size: 11px;
  line-height: 1.3;
  font-weight: 900;
}
.status-ok {
  color: #047857;
  background: rgba(16, 185, 129, 0.12);
}
.status-off {
  color: #64748b;
  background: rgba(100, 116, 139, 0.13);
}
.status-warn {
  color: #b45309;
  background: rgba(245, 158, 11, 0.16);
}
.status-info {
  color: #1d4ed8;
  background: rgba(37, 99, 235, 0.12);
}
.status-value {
  margin: 13px 0 0;
  color: var(--hira-fg);
  font-size: 27px;
  line-height: 1.15;
  font-weight: 900;
  overflow-wrap: anywhere;
  letter-spacing: 0;
}
.status-detail {
  margin: 8px 0 0;
  color: var(--hira-muted);
  font-size: 14px;
  line-height: 1.5;
  font-weight: 600;
  overflow-wrap: anywhere;
}
.resolver-card {
  display: grid;
  gap: 18px;
  margin-top: 28px;
}
.resolver-summary {
  display: grid;
  gap: 12px;
  padding: 18px;
  border-radius: 8px;
  background: var(--hira-surface-strong);
  border: 1px solid var(--hira-border);
}
.resolver-platform {
  display: inline-flex;
  width: fit-content;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  border-radius: 8px;
  background: rgba(37, 99, 235, 0.1);
  color: #1d4ed8;
  font-size: 13px;
  line-height: 1.3;
  font-weight: 900;
}
.resolver-title {
  margin: 0;
  color: var(--hira-fg);
  font-size: 33px;
  line-height: 1.18;
  font-weight: 900;
  letter-spacing: 0;
  overflow-wrap: anywhere;
}
.resolver-author,
.resolver-desc,
.resolver-url {
  margin: 0;
  color: var(--hira-muted);
  font-size: 15px;
  line-height: 1.55;
  font-weight: 600;
  letter-spacing: 0;
  overflow-wrap: anywhere;
}
.resolver-desc {
  color: rgba(19, 24, 34, 0.78);
  white-space: pre-line;
}
.resolver-url {
  font-family: Consolas, "JetBrains Mono", monospace;
  font-size: 12px;
}
.resolver-metrics {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
}
.metric-card {
  min-height: 92px;
  padding: 14px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.82);
  border: 1px solid var(--hira-border);
}
.metric-label {
  color: var(--hira-muted);
  font-size: 12px;
  line-height: 1.35;
  font-weight: 800;
}
.metric-value {
  margin-top: 8px;
  color: var(--hira-fg);
  font-family: Consolas, "JetBrains Mono", monospace;
  font-size: 31px;
  line-height: 1;
  font-weight: 900;
}
.error-panel {
  display: grid;
  gap: 16px;
  margin-top: 28px;
}
.error-reason {
  padding: 18px;
  border-radius: 8px;
  background: rgba(243, 18, 96, 0.08);
  border: 1px solid rgba(243, 18, 96, 0.18);
}
.error-label {
  color: #be123c;
  font-size: 12px;
  line-height: 1.35;
  font-weight: 900;
}
.error-text {
  margin: 9px 0 0;
  color: #881337;
  font-size: 19px;
  line-height: 1.45;
  font-weight: 800;
  white-space: pre-line;
  overflow-wrap: anywhere;
}
.error-suggestion {
  padding: 14px 16px;
  border-radius: 8px;
  background: rgba(245, 158, 11, 0.12);
  border: 1px solid rgba(245, 158, 11, 0.2);
  color: #92400e;
  font-size: 15px;
  line-height: 1.5;
  font-weight: 700;
}
.error-detail-list {
  display: grid;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.error-detail-list li {
  padding: 10px 12px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.78);
  border: 1px solid var(--hira-border);
  color: var(--hira-muted);
  font-family: Consolas, "JetBrains Mono", monospace;
  font-size: 12px;
  line-height: 1.45;
  overflow-wrap: anywhere;
}
.render-footer {
  display: flex;
  justify-content: center;
  margin-top: 24px;
  color: rgba(19, 24, 34, 0.35);
  font-family: Consolas, "JetBrains Mono", monospace;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0;
}
</style>
</head>
<body>
${body}
</body>
</html>`

const h = createElement

const decorNodes = (watermark: string) => [
  h('div', { key: 'dots', className: 'dot-matrix', 'aria-hidden': 'true' },
    Array.from({ length: 16 }, (_, index) => h('span', { key: index }))
  ),
  h('div', { key: 'corner', className: 'corner-code', 'aria-hidden': 'true' }, 'SYS.32.91'),
  h('div', { key: 'watermark', className: 'guide-watermark', 'aria-hidden': 'true' }, watermark)
]

export const renderTemplateHtml = ({
  eyebrow,
  hero,
  title,
  subtitle,
  watermark = hero,
  body,
  footer,
  width = 920
}: TemplateHtmlOptions) => createDocument(renderToStaticMarkup(
  h('main', { id: 'container', 'data-template-engine': 'react-static' },
    h('section', { className: 'hira-render-shell' },
      ...decorNodes(watermark),
      h('div', { className: 'render-content' },
        h('header', { className: 'render-header' },
          h('div', null,
            h('div', { className: 'system-line' },
              h('span', { className: 'system-dot' }),
              eyebrow
            ),
            h('h1', { className: 'hero-word' }, hero)
          ),
          h('div', { className: 'module-meta' },
            h('span', { className: 'header-label' }, 'CURRENT MODULE'),
            h('div', { className: 'module-title' }, title),
            subtitle ? h('div', { className: 'module-subtitle' }, subtitle) : null
          )
        ),
        h('div', { dangerouslySetInnerHTML: { __html: body } }),
        footer ? h('footer', { className: 'render-footer' }, footer) : null
      )
    )
  )
), width)

const sectionColors = ['#2563eb', '#f31260', '#0d9488', '#7c3aed', '#d97706']

const renderCommandItems = (items: HelpCardItem[]) => `
  <div class="command-grid">
    ${items.map(item => `
    <article class="command-item">
      <div class="command-icon">${escapeHtml(iconText(item))}</div>
      <div class="command-body">
        <h3 class="command-title">${escapeHtml(item.title)}</h3>
        <p class="command-desc">${escapeHtml(item.description)}</p>
      </div>
    </article>`).join('')}
  </div>`

export const buildHelpCardHtml = (groups: HelpCardGroup[]) => renderTemplateHtml({
  eyebrow: 'SYSTEM_READY',
  hero: 'COMMANDS',
  title: '插件帮助',
  subtitle: '常用命令、点歌、多平台解析和轻量功能一览。',
  watermark: 'GUIDE',
  footer: 'Generated by karin-plugin-hira',
  body: `
    <div class="section-list">
      ${groups.map((group, index) => `
      <section class="command-section" style="--section-color: ${sectionColors[index % sectionColors.length]}">
        <div class="section-heading">
          <div class="section-bar"></div>
          <h2 class="section-title">${escapeHtml(group.title)}</h2>
        </div>
        ${renderCommandItems(group.items)}
        ${(group.subGroups || []).map(subGroup => `
        <div class="subgroup">
          <h3 class="subgroup-title">${escapeHtml(subGroup.title)}</h3>
          ${renderCommandItems(subGroup.items)}
        </div>`).join('')}
      </section>`).join('')}
    </div>`
})

export const buildMusicListCardHtml = (items: MusicListCardItem[], page: number) => renderTemplateHtml({
  eyebrow: 'SEARCH.RESULTS',
  hero: 'MUSIC',
  title: '点歌列表',
  subtitle: `第 ${page} 页，发送序号点歌，发送 #下一页 查看更多。`,
  watermark: 'PICK',
  footer: 'Send a number to choose a track',
  body: `
      <div class="music-list">
        ${items.map((item, index) => `
        <article class="music-row">
          <div class="music-index">${index + 1}</div>
          <div class="song-main">
            <h2 class="song-title">${escapeHtml(compactText(item.title, 56))}</h2>
            <p class="song-artists">${escapeHtml(compactText(item.artists, 70))}</p>
          </div>
          <div class="duration">${escapeHtml(item.duration || '')}</div>
        </article>`).join('')}
      </div>
      <p class="card-tip">发送序号点歌，也可以发送 #下一页 翻页。</p>`
})

const statusText = (status: StatusCardItem['status']) => ({
  ok: 'ON',
  off: 'OFF',
  warn: 'WARN',
  info: 'INFO'
})[status || 'info']

export const buildStatusCardHtml = (options: StatusCardOptions) => renderTemplateHtml({
  eyebrow: options.eyebrow || 'SYSTEM.STATUS',
  hero: 'STATUS',
  title: options.title,
  subtitle: options.subtitle,
  watermark: 'STATE',
  footer: options.footer || 'Generated by karin-plugin-hira',
  body: `
    <div class="status-grid">
      ${options.items.map(item => {
        const status = item.status || 'info'
        return `
        <article class="status-item">
          <div class="status-head">
            <div class="status-label">${escapeHtml(item.label)}</div>
            <div class="status-pill status-${status}">${statusText(status)}</div>
          </div>
          <div class="status-value">${escapeHtml(item.value)}</div>
          ${item.detail ? `<p class="status-detail">${escapeHtml(item.detail)}</p>` : ''}
        </article>`
      }).join('')}
    </div>`
})

const mediaCount = (items: unknown[] | undefined) => Array.isArray(items) ? items.length : 0

const metricCard = (label: string, value: string | number) => `
  <article class="metric-card">
    <div class="metric-label">${escapeHtml(label)}</div>
    <div class="metric-value">${escapeHtml(value)}</div>
  </article>`

const xiaoheiheCountText = (value: number, unit: string) => value > 0 ? `${value} ${unit}` : ''

const stripResolverCommentSections = (value: string) => (
  value
    .replace(/\n\n热门(?:评论|回复)\n[\s\S]*$/u, '')
    .trim()
)

const xiaoheihePreviewDocument = (body: string, width = 920) => `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=${width}, initial-scale=1">
<style>
* { box-sizing: border-box; }
body {
  margin: 0;
  width: ${width}px;
  background: transparent;
  color: #18181b;
  font-family: HarmonyOSHans-Regular, "HarmonyOS Sans SC", "Microsoft YaHei", "PingFang SC", Arial, sans-serif;
}
#container {
  width: ${width}px;
  padding: 8px;
}
.xhh-preview-shell {
  width: 100%;
  min-height: 360px;
  padding: 20px;
  border-radius: 8px;
  background: #fff;
  border: 1px solid rgba(24, 24, 27, 0.08);
  box-shadow: none;
  overflow: hidden;
}
.xhh-topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 18px;
}
.xhh-brand {
  display: flex;
  align-items: center;
  gap: 8px;
  color: #52525b;
  font-size: 13px;
  line-height: 1.35;
  font-weight: 850;
}
.xhh-brand-dot {
  width: 9px;
  height: 9px;
  border-radius: 999px;
  background: #22c55e;
}
.xhh-source {
  color: #a1a1aa;
  font-size: 12px;
  line-height: 1.35;
  font-weight: 800;
}
.xhh-main {
  display: grid;
  grid-template-columns: 168px 1fr;
  gap: 20px;
  align-items: start;
}
.xhh-main-no-cover {
  display: block;
}
.xhh-cover {
  width: 168px;
  height: 168px;
  border-radius: 8px;
  object-fit: cover;
  background: #f4f4f5;
}
.xhh-title {
  margin: 0;
  color: #18181b;
  font-size: 30px;
  line-height: 1.22;
  font-weight: 900;
  letter-spacing: 0;
  overflow-wrap: anywhere;
}
.xhh-author {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 13px;
}
.xhh-avatar,
.xhh-avatar-fallback {
  flex: 0 0 auto;
  width: 36px;
  height: 36px;
  border-radius: 999px;
}
.xhh-avatar {
  object-fit: cover;
  background: #f4f4f5;
}
.xhh-avatar-fallback {
  display: grid;
  place-items: center;
  background: linear-gradient(135deg, #d9f99d, #22c55e);
  color: #14532d;
  font-size: 14px;
  font-weight: 900;
}
.xhh-author-name {
  color: #27272a;
  font-size: 14px;
  line-height: 1.35;
  font-weight: 850;
}
.xhh-author-meta {
  margin-top: 2px;
  color: #71717a;
  font-size: 12px;
  line-height: 1.35;
  font-weight: 650;
}
.xhh-desc {
  margin: 16px 0 0;
  color: #3f3f46;
  font-size: 16px;
  line-height: 1.68;
  font-weight: 520;
  white-space: pre-line;
  overflow-wrap: anywhere;
}
.xhh-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
  margin-top: 15px;
}
.xhh-chip {
  padding: 5px 9px;
  border-radius: 999px;
  background: #f4f4f5;
  color: #52525b;
  font-size: 12px;
  line-height: 1.35;
  font-weight: 800;
}
.xhh-divider {
  height: 1px;
  margin: 20px 0 14px;
  background: #e4e4e7;
}
.xhh-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}
.xhh-stats {
  display: flex;
  flex-wrap: wrap;
  gap: 14px;
  color: #71717a;
  font-size: 13px;
  line-height: 1.35;
  font-weight: 800;
}
.xhh-mark {
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

export const buildResolverPreviewCardHtml = (post: ResolvedPost, defaultDescription?: string, options: ResolverPreviewCardOptions = {}) => {
  const extras = post.extras || {}
  const commentsEnabled = options.commentsEnabled ?? true
  const cover = extras.coverUrl || post.images[0]
  const tags = (extras.tags || []).slice(0, 4)
  const title = compactText(post.title || post.displayName, 58)
  const rawDescription = commentsEnabled ? post.description : stripResolverCommentSections(post.description || '')
  const description = compactText(rawDescription || defaultDescription || `已识别${post.displayName}分享，完整内容将随后发送。`, 150)
  const author = post.author || post.displayName
  const avatarText = compactText(author, 1)
  const meta = [extras.location, extras.createdAt ? String(extras.createdAt) : undefined].filter(Boolean).join(' · ')
  const stats = [
    xiaoheiheCountText(mediaCount(post.images), '张图片'),
    xiaoheiheCountText(mediaCount(post.videos), '个视频'),
    commentsEnabled ? xiaoheiheCountText(mediaCount(extras.commentBlocks), '条评论') : ''
  ].filter(Boolean)

  return xiaoheihePreviewDocument(`
    <main id="container">
      <article class="xhh-preview-shell">
        <header class="xhh-topbar">
          <div class="xhh-brand"><span class="xhh-brand-dot"></span>${escapeHtml(post.displayName)}</div>
          <div class="xhh-source">Hira Resolver</div>
        </header>
        <section class="${cover ? 'xhh-main' : 'xhh-main-no-cover'}">
          ${cover ? `<img class="xhh-cover" src="${escapeHtml(cover)}" alt="">` : ''}
          <div class="xhh-content">
            <h1 class="xhh-title">${escapeHtml(title)}</h1>
            <div class="xhh-author">
              ${extras.authorAvatar
                ? `<img class="xhh-avatar" src="${escapeHtml(extras.authorAvatar)}" alt="">`
                : `<div class="xhh-avatar-fallback">${escapeHtml(avatarText)}</div>`}
              <div>
                <div class="xhh-author-name">${escapeHtml(author)}</div>
                ${meta ? `<div class="xhh-author-meta">${escapeHtml(meta)}</div>` : ''}
              </div>
            </div>
            <p class="xhh-desc">${escapeHtml(description)}</p>
            ${tags.length > 0
              ? `<div class="xhh-chips">${tags.map(tag => `<span class="xhh-chip">#${escapeHtml(tag)}</span>`).join('')}</div>`
              : ''}
          </div>
        </section>
        ${stats.length > 0 ? `
        <div class="xhh-divider"></div>
        <footer class="xhh-footer">
          <div class="xhh-stats">${stats.map(item => `<span>${escapeHtml(item)}</span>`).join('')}</div>
          <div class="xhh-mark">karin-plugin-hira</div>
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
  const description = post.description ? compactText(post.description, 260) : '已识别分享链接，媒体内容将随卡片一并发送。'

  return renderTemplateHtml({
    eyebrow: 'RESOLVER.RESULT',
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

export const buildErrorCardHtml = (options: ErrorCardOptions) => renderTemplateHtml({
  eyebrow: 'SYSTEM.ERROR',
  hero: 'ERROR',
  title: '诊断卡片',
  subtitle: options.subtitle || options.title,
  watermark: 'FAIL',
  footer: 'Generated by karin-plugin-hira',
  body: `
    <section class="error-panel">
      <div class="error-reason">
        <div class="error-label">${escapeHtml(options.title)}</div>
        <p class="error-text">${escapeHtml(options.reason)}</p>
      </div>
      ${options.suggestion ? `<div class="error-suggestion">${escapeHtml(options.suggestion)}</div>` : ''}
      ${(options.details || []).length > 0
        ? `<ul class="error-detail-list">${(options.details || []).map(detail => `<li>${escapeHtml(detail)}</li>`).join('')}</ul>`
        : ''}
    </section>`
})

export const writeCardHtmlFile = (html: string, name: string) => {
  const safeName = name.replace(/[^\w.-]+/g, '_') || 'card'
  const dir = path.join(karinPathHtml, Root.pluginName, `card-${safeName}`)
  fs.mkdirSync(dir, { recursive: true })
  const contentHash = crypto.createHash('md5').update(html).digest('hex').slice(0, 8)
  const file = path.join(dir, `${safeName}-${contentHash}.html`)
  if (fs.existsSync(file)) {
    const now = new Date()
    fs.utimesSync(file, now, now)
    return file
  }
  fs.writeFileSync(file, html, 'utf8')
  return file
}

export const renderCardImage = async ({
  name,
  html,
  width = 760,
  writeHtml = writeCardHtmlFile,
  render = karinRender.render.bind(karinRender) as (options: Record<string, unknown>) => Promise<string | string[]>
}: RenderOptions): Promise<ImageElement[]> => {
  const file = writeHtml(html, name)
  const result = await render({
    name: `${Root.pluginName}/card-${name}`,
    file,
    selector: '#container',
    fullPage: false,
    type: 'png',
    captureBeyondViewport: true,
    omitBackground: true,
    setViewport: {
      width,
      height: 900,
      deviceScaleFactor: 1
    },
    pageGotoParams: {
      waitUntil: 'load',
      timeout: 10_000
    }
  })
  const images = Array.isArray(result) ? result : [result]
  const elements = images.map(image => segment.image(`base64://${image}`))
  logger.debug(`[${Root.pluginName}] Render card ${name}: ${file}, images=${elements.length}`)
  return elements
}

export const logCardRenderFailure = (name: string, error: unknown) => {
  const message = error instanceof Error ? error.stack || error.message : String(error)
  logger.error(`[${Root.pluginName}] Render card ${name} failed: ${message}`)
}
