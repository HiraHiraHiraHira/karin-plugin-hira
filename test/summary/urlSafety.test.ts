import { describe, expect, it } from 'vitest'

import { validatePublicUrl } from '@/summary/urlSafety'

describe('summary URL safety', () => {
  it.each([
    'file:///C:/Windows/win.ini',
    'ftp://example.test/article',
    'http://127.0.0.1:8080/admin',
    'http://10.0.0.1/internal',
    'http://192.168.1.1/router',
    'http://[::1]/admin',
    'http://[::ffff:127.0.0.1]/admin',
    'http://[::127.0.0.1]/admin',
    'http://[64:ff9b::127.0.0.1]/admin',
    'http://[2002:7f00:1::]/admin',
    'http://[ff02::1]/multicast',
    'http://[fec0::1]/sitelocal',
    'https://user:password@example.test/article'
  ])('rejects unsafe URL %s', async url => {
    await expect(validatePublicUrl(url)).rejects.toThrow()
  })
})
