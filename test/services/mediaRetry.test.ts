import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { sendWithMediaRetry, withCacheBuster } from '@/services/mediaRetry'

const runtimeMocks = vi.hoisted(() => ({
  downloadFile: vi.fn(),
  createTempFilePath: vi.fn()
}))

vi.mock('@/runtime/downloader', async () => {
  // vi.mock 工厂会被提升, 只能用动态 import 拿到真实文件系统写入下载结果.
  const fsActual = await import('node:fs')
  runtimeMocks.downloadFile.mockImplementation(async (options: { output: string }) => {
    fsActual.writeFileSync(options.output, Buffer.alloc(2048, 1))
    return options.output
  })
  return { downloadFile: runtimeMocks.downloadFile }
})

vi.mock('@/runtime/temp', () => {
  runtimeMocks.createTempFilePath.mockImplementation((_scope: string, ext: string) => (
    path.join(os.tmpdir(), `hira-media-retry-${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`)
  ))
  return { createTempFilePath: runtimeMocks.createTempFilePath }
})

describe('sendWithMediaRetry', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('downloads images inside fake forward nodes and retries with local files', async () => {
    const send = vi.fn(async (_payload?: unknown) => ({ messageId: 'ok' }) as unknown)
    send.mockRejectedValueOnce(new Error('risk control'))
    const nodes = [{
      type: 'node',
      subType: 'fake',
      userId: '10001',
      nickname: '发帖人',
      message: [
        { type: 'text', text: '正文' },
        { type: 'image', file: 'https://img.example.test/a.jpg?w=1080' }
      ]
    }]

    const result = await sendWithMediaRetry(send, nodes)

    expect(result).toEqual({ messageId: 'ok' })
    expect(send).toHaveBeenCalledTimes(2)
    expect(runtimeMocks.downloadFile).toHaveBeenCalledWith(expect.objectContaining({
      url: 'https://img.example.test/a.jpg?w=1080',
      headers: expect.objectContaining({ Referer: 'https://img.example.test/' })
    }))
    const retried = send.mock.calls[1]?.[0] as typeof nodes
    const image = retried[0]?.message?.[1] as { file?: string }
    expect(image.file).toMatch(/\.jpg$/)
    expect(image.file).not.toMatch(/^https?:/)
    // 本地副本必须被追加随机字节, 否则 QQ 侧 hash 不变仍然会被风控.
    expect(fs.statSync(image.file as string).size).toBe(2053)
  })

  it('falls back to cache-busted urls when localizing fails', async () => {
    runtimeMocks.downloadFile.mockRejectedValue(new Error('download failed'))
    const send = vi.fn(async (_payload?: unknown) => ({ messageId: 'ok' }) as unknown)
    send.mockRejectedValueOnce(new Error('risk control'))
    const payload = [{ type: 'image', file: 'https://img.example.test/b.jpg' }]

    await sendWithMediaRetry(send, payload)

    const retried = send.mock.calls[1]?.[0] as Array<{ file?: string }>
    expect(retried[0]?.file).toMatch(/^https:\/\/img\.example\.test\/b\.jpg\?hira-retry=/)
  })
})

describe('withCacheBuster', () => {
  it('keeps signed urls untouched', () => {
    expect(withCacheBuster('https://cdn.example.test/a.jpg?X-Amz-Signature=abc')).toBe('https://cdn.example.test/a.jpg?X-Amz-Signature=abc')
  })
})
