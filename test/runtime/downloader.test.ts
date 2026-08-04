import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { downloadFile } from '@/runtime/downloader'

describe('downloadFile', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('rejects oversized responses before leaving a partial output', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hira-download-limit-'))
    const output = path.join(root, 'video.mp4')
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array([1, 2, 3, 4]), {
      status: 200,
      headers: { 'content-length': '4', 'content-type': 'video/mp4' }
    })))

    await expect(downloadFile({
      url: 'https://cdn.example.test/video.mp4',
      output,
      maxBytes: 3
    })).rejects.toThrow('超过 3 字节限制')

    expect(fs.existsSync(output)).toBe(false)
    expect(fs.readdirSync(root)).toEqual([])
  })

  it('writes a successful download through a temporary file and renames it', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hira-download-ok-'))
    const output = path.join(root, 'audio.m4a')
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), {
      status: 200,
      headers: { 'content-length': '3', 'content-type': 'audio/mp4' }
    })))

    await expect(downloadFile({
      url: 'https://cdn.example.test/audio.m4a',
      output,
      maxBytes: 3
    })).resolves.toBe(output)

    expect(fs.readFileSync(output)).toEqual(Buffer.from([1, 2, 3]))
    expect(fs.readdirSync(root)).toEqual(['audio.m4a'])
  })
})
