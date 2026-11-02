import axios from 'axios'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { fetchJson, fetchResponse, readResponseBytes, toAxiosProxy } from '@/services/http'

vi.mock('axios', () => ({
  default: { request: vi.fn() }
}))

// 模拟一个会响应 abort 的 fetch：收到中止信号时抛出 AbortError
const abortableFetch = () => vi.fn((_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
  const signal = init?.signal
  const abort = () => reject(new DOMException('The operation was aborted.', 'AbortError'))
  if (!signal) return
  if (signal.aborted) abort()
  else signal.addEventListener('abort', abort, { once: true })
}))

describe('fetchJson', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  beforeEach(() => {
    vi.mocked(axios.request).mockReset()
  })

  it('can disable default headers for endpoints that reject custom user agents', async () => {
    const fetchMock = vi.fn(async () => {
      return new Response(JSON.stringify({ ok: true }), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(fetchJson('https://example.test/api', { defaultHeaders: false })).resolves.toEqual({ ok: true })

    expect(fetchMock).toHaveBeenCalledWith('https://example.test/api', expect.objectContaining({
      headers: {}
    }))
  })
  it('rejects bodies that exceed the configured byte limit', async () => {
    await expect(readResponseBytes(new Response('1234'), 3)).rejects.toThrow('响应超过 3 字节限制')
  })

  it('converts authenticated proxy URLs for axios', () => {
    expect(toAxiosProxy('http://user:pass@127.0.0.1:7890')).toEqual({
      protocol: 'http',
      host: '127.0.0.1',
      port: 7890,
      auth: {
        username: 'user',
        password: 'pass'
      }
    })
  })

  it('wraps non-JSON responses in a specific Chinese error with the HTTP status', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<!doctype html><html>blocked</html>', { status: 200 })))

    await expect(fetchJson('https://example.test/api')).rejects.toThrow(
      '接口返回的不是 JSON（HTTP 200，开头：<!doctype html><html>blocked</html>）'
    )
  })

  it('reports non-OK responses with a Chinese status message', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('oops', { status: 500 })))

    await expect(fetchJson('https://example.test/api')).rejects.toThrow('接口返回 HTTP 500')
  })
})

describe('fetchResponse', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('throws a Chinese timeout error when the local timeout fires', async () => {
    vi.stubGlobal('fetch', abortableFetch())

    await expect(fetchResponse('https://example.test/slow', { timeoutMs: 20 })).rejects.toThrow('请求超时（20 ms）')
  })

  it('keeps the caller abort working even with a long local timeout', async () => {
    vi.stubGlobal('fetch', abortableFetch())
    const controller = new AbortController()

    const promise = fetchResponse('https://example.test/slow', { timeoutMs: 10_000, signal: controller.signal })
    controller.abort()

    await expect(promise).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('keeps the local timeout working when the caller also passes a signal', async () => {
    vi.stubGlobal('fetch', abortableFetch())
    const controller = new AbortController()

    await expect(
      fetchResponse('https://example.test/slow', { timeoutMs: 20, signal: controller.signal })
    ).rejects.toThrow('请求超时（20 ms）')
  })

  it('wraps network failures in a Chinese message while keeping the original detail', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new TypeError('fetch failed')
    }))

    await expect(fetchResponse('https://example.test/api')).rejects.toThrow('网络请求失败：fetch failed')
  })

  it('wraps proxy (axios) network failures in a Chinese message', async () => {
    vi.mocked(axios.request).mockRejectedValueOnce(new Error('connect ECONNREFUSED 127.0.0.1:7890'))

    await expect(
      fetchResponse('https://example.test/api', { proxy: 'http://127.0.0.1:7890' })
    ).rejects.toThrow('网络请求失败：connect ECONNREFUSED 127.0.0.1:7890')
  })

  it('keeps caller cancellations from the proxy path as-is', async () => {
    const canceled = Object.assign(new Error('canceled'), { name: 'CanceledError', code: 'ERR_CANCELED' })
    vi.mocked(axios.request).mockRejectedValueOnce(canceled)

    await expect(
      fetchResponse('https://example.test/api', { proxy: 'http://127.0.0.1:7890' })
    ).rejects.toBe(canceled)
  })
})
