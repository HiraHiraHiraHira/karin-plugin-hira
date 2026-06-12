const trailingPunctuation = /[，。！？、；;,.!?]+$/

export const normalizeSharedUrl = (url: string) => {
  return url
    .replaceAll('\\/', '/')
    .replace(/^https:(?!\/\/)\//, 'https://')
    .replace(/^http:(?!\/\/)\//, 'http://')
    .replace(trailingPunctuation, '')
}

export const extractFirstUrl = (message: string) => {
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
