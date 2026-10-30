import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

import { Config } from '@/config'
import { downloadFile } from '@/runtime/downloader'
import { createTempFilePath } from '@/runtime/temp'

/**
 * 带签名的查询参数名(大小写不敏感, 覆盖 cos/oss/aws 的 `x-expires` / `X-Amz-Signature` 前缀写法).
 * 这类 URL 追加任意参数都会让签名失效, 因此必须原样返回.
 */
const signedQueryKeyPattern = /(?:^|[-_])(?:sign|signature|sig|expires|auth_key|token)$/i

const hasSignedQuery = (url: string) => {
  const queryIndex = url.indexOf('?')
  if (queryIndex < 0) return false
  const query = url.slice(queryIndex + 1).split('#')[0]
  return query.split('&').some(pair => signedQueryKeyPattern.test(pair.split('=')[0]))
}

/**
 * 风控重发:首次发送失败(常见图床风控)时,给图片 URL 追加随机查询字节改 hash 后重试一次.
 * 参考 R `utils/retry.js` replyWithRetry.仅改 URL,不动本地文件.
 * 签名 URL 追加参数只会破坏签名, 故原样返回.
 */
export const withCacheBuster = (url: string) => (
  hasSignedQuery(url)
    ? url
    : `${url}${url.includes('?') ? '&' : '?'}hira-retry=${Math.random().toString(36).slice(2, 8)}${Date.now() % 1000}`
)

type RewriteTarget = { type?: string, file?: unknown, url?: unknown }

const imageHttpUrlOf = (element: unknown) => {
  if (typeof element !== 'object' || element === null) return undefined
  const segment = element as RewriteTarget
  if (segment.type !== 'image') return undefined
  const raw = typeof segment.file === 'string' ? segment.file : typeof segment.url === 'string' ? segment.url : undefined
  if (!raw || !/^https?:/i.test(raw)) return undefined
  return raw
}

const replaceImageUrl = (element: object, url: string) => {
  const segment = element as RewriteTarget
  return { ...segment, ...(typeof segment.file === 'string' ? { file: url } : { url }) }
}

type RewriteResult<T> = { value: T, changed: boolean }

/**
 * 递归改写消息中的图片 URL, 包括合并转发节点里的媒体, 返回是否真的改到了东西.
 */
const rewriteImageUrls = async (payload: unknown, rewrite: (url: string) => Promise<string | undefined>): Promise<RewriteResult<unknown>> => {
  if (Array.isArray(payload)) {
    const results = await Promise.all(payload.map(item => rewriteImageUrls(item, rewrite)))
    return {
      value: results.map(result => result.value),
      changed: results.some(result => result.changed)
    }
  }

  if (typeof payload === 'object' && payload !== null) {
    const node = payload as { type?: string, message?: unknown }
    if (node.type === 'node' && Array.isArray(node.message)) {
      const inner = await rewriteImageUrls(node.message, rewrite)
      return inner.changed
        ? { value: { ...(payload as object), message: inner.value }, changed: true }
        : { value: payload, changed: false }
    }
  }

  const url = imageHttpUrlOf(payload)
  if (!url) return { value: payload, changed: false }
  const next = await rewrite(url)
  if (!next || next === url) return { value: payload, changed: false }
  return { value: replaceImageUrl(payload as object, next), changed: true }
}

export const bustImageUrls = (elements: unknown): unknown[] => {
  const list = Array.isArray(elements) ? elements : [elements]
  return list.map(element => {
    if (typeof element !== 'object' || element === null) return element
    const node = element as { type?: string, message?: unknown }
    if (node.type === 'node' && Array.isArray(node.message)) {
      return { ...(element as object), message: bustImageUrls(node.message) }
    }
    const url = imageHttpUrlOf(element)
    return url ? replaceImageUrl(element, withCacheBuster(url)) : element
  })
}

export const mediaReferer = (url: string) => {
  try {
    const parsed = new URL(url)
    return `${parsed.protocol}//${parsed.host}/`
  } catch {
    return url
  }
}

const imageExtension = (url: string) => {
  try {
    const ext = path.posix.extname(new URL(url).pathname).replace(/^\./, '').toLowerCase()
    return /^(?:jpe?g|png|webp|gif|bmp|avif)$/.test(ext) ? ext : 'jpg'
  } catch {
    return 'jpg'
  }
}

/**
 * 下载图片到本地并追加随机字节, 让 QQ 侧看到新的文件 hash (参考 R utils/retry.js:220-283).
 * 追加字节只改变 hash, 不破坏图片解码.
 */
export const downloadImageToLocal = async (url: string) => {
  const output = createTempFilePath('retry', imageExtension(url))
  await downloadFile({
    url,
    output,
    headers: {
      Referer: mediaReferer(url),
      Accept: 'image/webp,image/apng,image/*,*/*;q=0.8'
    },
    timeoutMs: 30_000,
    maxBytes: Config.runtime.maxVideoFileSizeBytes
  })

  const size = fs.statSync(output).size
  // 小于 1KB 基本是错误页/占位图, 重发也不会成功.
  if (size < 1024) {
    fs.rmSync(output, { force: true })
    throw new Error('图片内容过小')
  }
  fs.appendFileSync(output, crypto.randomBytes(5))
  return output.replace(/\\/g, '/')
}

/**
 * 先正常发; 失败后把远程图片下载到本地(带域名 Referer + 随机字节)重发,
 * 再失败则退回改查询参数改 hash 的轻量重试. 两条兜底都无效时抛首次错误.
 */
export const sendWithMediaRetry = async <P>(send: (payload: P) => Promise<unknown> | unknown, payload: P): Promise<unknown> => {
  try {
    return await send(payload)
  } catch (firstError) {
    try {
      const localized = await rewriteImageUrls(payload, async url => {
        try {
          return await downloadImageToLocal(url)
        } catch {
          return undefined
        }
      })
      if (localized.changed) return await send(localized.value as P)
    } catch {
      // 本地化失败就继续尝试轻量重试.
    }

    try {
      const busted = await rewriteImageUrls(payload, async url => withCacheBuster(url))
      if (busted.changed) return await send(busted.value as P)
    } catch {
      // 两种重试都失败, 交回调用方降级.
    }

    throw firstError
  }
}
