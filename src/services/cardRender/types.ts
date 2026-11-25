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
  index?: number
  title: string
  artists: string
  duration?: string
  coverUrl?: string
  album?: string
  source?: string
}

export type MusicListCardOptions = {
  keyword?: string
  source?: string
  coverUrl?: string
  ttlSeconds?: number
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
  footer?: string
  items: StatusCardItem[]
}

export type UpdateCardState = 'available' | 'latest' | 'preview' | 'error'

export type UpdateCardOptions = {
  state: UpdateCardState
  title: string
  subtitle?: string
  current: string
  latest?: string
  source?: string
  lagCount?: number
  meta?: Array<{
    label: string
    value: string
  }>
  details?: string[]
  tip?: string
  footer?: string
}

export type TemplateHtmlOptions = {
  eyebrow: string
  hero: string
  title: string
  subtitle?: string
  watermark?: string
  body: string
  footer?: string
  width?: number
  useDarkTheme?: boolean
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

export type RenderOptions = {
  name: string
  html: string
  width?: number
  writeHtml?: (html: string, name: string) => string
  render?: (options: Record<string, unknown>) => Promise<string | string[]>
}

export const escapeHtml = (value: string | number | undefined) => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;')

export const compactText = (value: string, maxLength: number) => {
  const text = value.replace(/\s+/g, ' ').trim()
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}...` : text
}
