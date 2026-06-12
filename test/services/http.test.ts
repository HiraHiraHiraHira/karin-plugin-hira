import { afterEach, describe, expect, it, vi } from 'vitest'

import { fetchJson } from '@/services/http'

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
})
