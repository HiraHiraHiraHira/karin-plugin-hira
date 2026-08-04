import { afterEach, describe, expect, it, vi } from 'vitest'

import { fetchJson, readResponseBytes, toAxiosProxy } from '@/services/http'

describe('fetchJson', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
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
})
