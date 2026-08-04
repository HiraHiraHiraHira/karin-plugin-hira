import fs from 'node:fs'
import path from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'

import axios from 'axios'

import { Config } from '@/config'
import { toAxiosProxy } from '@/services/http'

export type DownloadOptions = {
  url: string
  output: string
  headers?: Record<string, string>
  timeoutMs?: number
  maxBytes?: number
  proxy?: string
}

const userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'

const contentLengthOf = (value: unknown) => {
  const contentLength = typeof value === 'string' ? value : undefined
  const parsed = Number(contentLength)
  return Number.isFinite(parsed) ? parsed : undefined
}

const byteLimit = (maxBytes: number | undefined) => {
  if (maxBytes === undefined) return undefined
  let total = 0
  return new Transform({
    transform(chunk, _encoding, callback) {
      total += Buffer.byteLength(chunk)
      if (total > maxBytes) {
        callback(new Error(`下载内容超过 ${maxBytes} 字节限制`))
        return
      }
      callback(null, chunk)
    }
  })
}

const writeDownloadedBody = async (body: NodeJS.ReadableStream | ReadableStream<Uint8Array>, output: string, maxBytes?: number) => {
  const webBody = body as ReadableStream<Uint8Array>
  const source = typeof (webBody as any).getReader === 'function'
    ? Readable.fromWeb(webBody as any)
    : body as NodeJS.ReadableStream
  const limiter = byteLimit(maxBytes)
  if (limiter) {
    await pipeline(source, limiter, fs.createWriteStream(output))
    return
  }
  await pipeline(source, fs.createWriteStream(output))
}

export const downloadFile = async (options: DownloadOptions) => {
  const timeoutMs = options.timeoutMs ?? Math.max(5, Config.runtime.downloadTimeoutSeconds) * 1000
  const maxBytes = options.maxBytes
  const temporaryOutput = `${options.output}.part-${process.pid}-${Math.random().toString(36).slice(2)}`
  fs.mkdirSync(path.dirname(options.output), { recursive: true })

  try {
    if (options.proxy?.trim()) {
      const response = await axios.get(options.url, {
        headers: {
          'User-Agent': userAgent,
          ...options.headers
        },
        timeout: timeoutMs,
        proxy: toAxiosProxy(options.proxy.trim()),
        responseType: 'stream',
        maxRedirects: 5,
        validateStatus: () => true
      })
      if (response.status < 200 || response.status >= 300) throw new Error(`下载失败：HTTP ${response.status}`)

      const contentLength = contentLengthOf(response.headers['content-length'])
      if (maxBytes !== undefined && contentLength !== undefined && contentLength > maxBytes) {
        response.data.destroy()
        throw new Error(`下载内容超过 ${maxBytes} 字节限制`)
      }
      await writeDownloadedBody(response.data, temporaryOutput, maxBytes)
    } else {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), timeoutMs)
      try {
        const response = await fetch(options.url, {
          headers: {
            'User-Agent': userAgent,
            ...options.headers
          },
          redirect: 'follow',
          signal: controller.signal
        })
        if (!response.ok || !response.body) throw new Error(`下载失败：HTTP ${response.status}`)

        const contentLength = contentLengthOf(response.headers.get('content-length'))
        if (maxBytes !== undefined && contentLength !== undefined && contentLength > maxBytes) {
          await response.body.cancel()
          throw new Error(`下载内容超过 ${maxBytes} 字节限制`)
        }
        await writeDownloadedBody(response.body, temporaryOutput, maxBytes)
      } finally {
        clearTimeout(timeout)
      }
    }

    fs.rmSync(options.output, { force: true })
    fs.renameSync(temporaryOutput, options.output)
    return options.output
  } catch (error) {
    fs.rmSync(temporaryOutput, { force: true })
    throw error
  }
}
