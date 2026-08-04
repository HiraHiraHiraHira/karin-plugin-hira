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
    'https://user:password@example.test/article'
  ])('rejects unsafe URL %s', async url => {
    await expect(validatePublicUrl(url)).rejects.toThrow()
  })
})
