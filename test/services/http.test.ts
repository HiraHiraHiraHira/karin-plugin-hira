import { createRequire } from 'node:module'

import axios from 'axios'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { fetchJson, fetchResponse, readResponseBytes, toAxiosProxy } from '@/services/http'

// insecure 分支走 axios 的独立通道，用 mock 拦截即可保证测试不触网。
const { axiosRequest } = vi.hoisted(() => ({ axiosRequest: vi.fn() }))

vi.mock('axios', () => ({ default: { request: axiosRequest } }))

// http.ts 的 insecure 分支用裸 require 取 node:https；ESM 测试环境默认没有这个全局函数。
const nodeRequire = createRequire(import.meta.url)

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
    // 代理通道的网络错误同样会重试，mock 必须持续失败，直到重试耗尽后抛出包装后的中文错误
    vi.mocked(axios.request).mockRejectedValue(new Error('connect ECONNREFUSED 127.0.0.1:7890'))

    await expect(
      fetchResponse('https://example.test/api', { proxy: 'http://127.0.0.1:7890', retryDelayMs: 0 })
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

describe('fetchResponse retry', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('retries network errors and 5xx three times with exponential backoff', async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(new Response('busy', { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(fetchJson('https://example.test/api', { retryDelayMs: 0 })).resolves.toEqual({ ok: true })

    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('does not retry client errors', async () => {
    const fetchMock = vi.fn(async () => new Response('missing', { status: 404 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(fetchJson('https://example.test/api', { retryDelayMs: 0 })).rejects.toThrow('HTTP 404')

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('retries through the resolver proxy wrapper', async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const { fetchResolverJson } = await import('@/services/resolverHttp')
    await expect(fetchResolverJson('https://example.test/api', { retryDelayMs: 0 })).resolves.toEqual({ ok: true })

    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})

describe('fetchResponse insecure branch', () => {
  beforeEach(() => {
    axiosRequest.mockReset()
    vi.stubGlobal('require', nodeRequire)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('rejects insecure requests that also pass a proxy without touching the network', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    // 两条通道互斥：静默择一会让调用方误以为 TLS 校验已放宽，必须在发请求前就报错。
    await expect(fetchResponse('https://example.test/x', { insecure: true, proxy: 'http://127.0.0.1:9' }))
      .rejects.toThrow('insecure 请求不支持代理')

    expect(axiosRequest).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('enforces maxBytes on the insecure branch and forwards the limit to axios', async () => {
    axiosRequest.mockResolvedValue({
      status: 200,
      statusText: 'OK',
      headers: {},
      data: Buffer.alloc(2048)
    })

    await expect(fetchResponse('https://example.test/x', { insecure: true, maxBytes: 1024 }))
      .rejects.toThrow('响应超过 1024 字节限制')

    expect(axiosRequest).toHaveBeenCalledWith(expect.objectContaining({ maxContentLength: 1024 }))
  })

  it('disables TLS verification only for the insecure request and returns fitting bodies', async () => {
    axiosRequest.mockResolvedValue({
      status: 200,
      statusText: 'OK',
      headers: {},
      data: Buffer.alloc(2048)
    })

    const response = await fetchResponse('https://example.test/x', { insecure: true, maxBytes: 4096 })

    expect(response.status).toBe(200)
    expect((await response.arrayBuffer()).byteLength).toBe(2048)
    // 放宽校验必须钉在这一条 axios 请求上（httpsAgent 由 node:https 真实构造）。
    expect(axiosRequest).toHaveBeenCalledWith(expect.objectContaining({
      maxContentLength: 4096,
      httpsAgent: expect.objectContaining({
        options: expect.objectContaining({ rejectUnauthorized: false })
      })
    }))
  })
})
