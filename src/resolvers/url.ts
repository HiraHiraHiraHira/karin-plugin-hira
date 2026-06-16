const trailingPunctuation = /[，。！？、；;,.!?]+$/

export type ShareCardMeta = {
  jumpUrl?: string
  title?: string
  desc?: string
  preview?: string
  tag?: string
}

export const normalizeSharedUrl = (url: string) => {
  return url
    .replaceAll('\\/', '/')
    .replace(/^https:(?!\/\/)\//, 'https://')
    .replace(/^http:(?!\/\/)\//, 'http://')
    .replace(trailingPunctuation, '')
}

const parseJsonObjectFrom = (text: string, start: number) => {
  const open = text.indexOf('{', start)
  if (open < 0) return undefined

  let depth = 0
  let inString = false
  let escaped = false
  for (let index = open; index < text.length; index++) {
    const char = text[index]
    if (inString) {
      if (escaped) {
        escaped = false
      } else if (char === '\\') {
        escaped = true
      } else if (char === '"') {
        inString = false
      }
      continue
    }

    if (char === '"') {
      inString = true
      continue
    }
    if (char === '{') depth++
    if (char === '}') depth--
    if (depth === 0) {
      try {
        return JSON.parse(text.slice(open, index + 1)) as Record<string, any>
      } catch {
        return undefined
      }
    }
  }

  return undefined
}

const stringField = (value: unknown) => typeof value === 'string' && value ? value : undefined

export const extractShareCardMeta = (message: string): ShareCardMeta | undefined => {
  const marker = message.indexOf('[json:')
  const root = parseJsonObjectFrom(message, marker >= 0 ? marker + '[json:'.length : 0)
  const news = root?.meta?.news
  if (!news || typeof news !== 'object') return undefined

  const jumpUrl = stringField(news.jumpUrl || news.url)
  const meta: ShareCardMeta = {
    jumpUrl: jumpUrl ? normalizeSharedUrl(jumpUrl) : undefined,
    title: stringField(news.title),
    desc: stringField(news.desc),
    preview: stringField(news.preview),
    tag: stringField(news.tag)
  }

  return Object.values(meta).some(Boolean) ? meta : undefined
}

export const extractFirstUrl = (message: string) => {
  const shareMeta = extractShareCardMeta(message)
  if (shareMeta?.jumpUrl) return shareMeta.jumpUrl

  const normalized = normalizeSharedUrl(message)
  return normalized.match(/https?:\/\/[^\s"'<>]+/)?.[0]?.replace(trailingPunctuation, '')
}

export const hostnameOf = (url: string) => {
  try {
    return new URL(url).hostname.toLowerCase()
  } catch {
    return undefined
  }
}
