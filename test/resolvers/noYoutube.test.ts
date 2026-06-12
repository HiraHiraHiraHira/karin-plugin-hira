import { describe, expect, it } from 'vitest'

import { matchResolver } from '@/resolvers/matcher'

describe('YouTube scope', () => {
  it('does not match YouTube links because Hira does not migrate YouTube features', () => {
    expect(matchResolver('https://youtu.be/abc')).toBeUndefined()
    expect(matchResolver('https://www.youtube.com/watch?v=abc')).toBeUndefined()
    expect(matchResolver('https://music.youtube.com/watch?v=abc')).toBeUndefined()
  })
})
