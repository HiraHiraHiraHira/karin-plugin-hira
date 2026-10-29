const trailingPunctuation = /[，。！？、；;,.!?]+$/
// 中文标点区间、汉字区间与全角符号区间：URL token 一旦被中文正文粘上，从这里开始都不属于链接。
const cjkBoundary = /[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/

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

/**
 * QQ 分享卡片会把自己的登录凭据塞进 jumpUrl，解析请求和对外回显都不能带出去。
 * 只作用于分享卡 jumpUrl；裸 `key`/`token` 是许多站点链接的功能参数，删掉会改坏链接，因此不收。
 */
const trackingCredential = /^(?:p_skey|skey|access_token|pass_ticket|ticket|clientkey|wxuin)$/i

const stripTrackingCredentials = (url: string) => {
  try {
    const parsed = new URL(url)
    const credentials = [...parsed.searchParams.keys()].filter(key => trackingCredential.test(key))
    if (credentials.length === 0) return url
    for (const key of credentials) parsed.searchParams.delete(key)
    return parsed.toString()
  } catch {
    return url
  }
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
    jumpUrl: jumpUrl ? stripTrackingCredentials(normalizeSharedUrl(jumpUrl)) : undefined,
    title: stringField(news.title),
    desc: stringField(news.desc),
    preview: stringField(news.preview),
    tag: stringField(news.tag)
  }

  return Object.values(meta).some(Boolean) ? meta : undefined
}

/** `[^\s"'<>]+` 会把中文正文一起吃进 token，所以先按首个中文标点或汉字截断。 */
const trimUrlToken = (token: string) => {
  const boundaryIndex = token.search(cjkBoundary)
  const head = boundaryIndex >= 0 ? token.slice(0, boundaryIndex) : token
  return head.replace(trailingPunctuation, '')
}

// BV 用 B站的 base58 字符集（排除 0OIl），前后必须是非字母数字边界：
// `附件BV…`（汉字紧贴）、`xac…`（英文粘连）不算分享码；`BV…` 后紧跟 `.zip` 这类
// 扩展名视作文件名而非分享。中文正文（逗号/空格紧邻）不受影响。
const bareBvidPattern = /(?<![\p{L}\p{N}])BV[1-9A-HJ-NP-Za-km-z]{10}(?![\p{L}\p{N}_])(?!\.\w{1,4}\b)/u
// AcFun 现行稿件 id 为 6 位以上数字；小写 `ac`，`AC4567号文件` 这类编号不误报。
const bareAcPattern = /(?<![\p{L}\p{N}])ac\d{6,}(?![\p{L}\p{N}_])/u

/** 聊天里常见的裸 ID（无链接纯文本分享）：补全成可解析的完整 URL。 */
export const expandBareShareId = (message: string) => {
  const bvid = message.match(bareBvidPattern)?.[0]
  if (bvid) return `https://www.bilibili.com/video/${bvid.replace(/^bv/i, 'BV')}`

  const ac = message.match(bareAcPattern)?.[0]
  if (ac) return `https://www.acfun.cn/v/${ac}`

  return undefined
}

export const extractFirstUrl = (message: string) => {
  const shareMeta = extractShareCardMeta(message)
  if (shareMeta?.jumpUrl) return shareMeta.jumpUrl

  const normalized = normalizeSharedUrl(message)
  const token = normalized.match(/https?:\/\/[^\s"'<>]+/)?.[0]
  if (token) return trimUrlToken(token)

  return expandBareShareId(normalized)
}

export const hostnameOf = (url: string) => {
  try {
    return new URL(url).hostname.toLowerCase()
  } catch {
    return undefined
  }
}
