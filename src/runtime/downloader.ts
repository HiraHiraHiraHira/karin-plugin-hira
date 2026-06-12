import fs from 'node:fs'
import { pipeline } from 'node:stream/promises'

export type DownloadOptions = {
  url: string
  output: string
  headers?: Record<string, string>
  timeoutMs?: number
}

export const downloadFile = async (options: DownloadOptions) => {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 60_000)

  try {
    const response = await fetch(options.url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
        ...options.headers
      },
      signal: controller.signal
    })
    if (!response.ok || !response.body) throw new Error(`下载失败：HTTP ${response.status}`)
    await pipeline(response.body, fs.createWriteStream(options.output))
    return options.output
  } finally {
    clearTimeout(timeout)
  }
}
