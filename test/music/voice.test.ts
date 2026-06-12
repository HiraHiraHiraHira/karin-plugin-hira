import { describe, expect, it } from 'vitest'

import { buildVoiceTempPaths } from '@/music/voice'

describe('buildVoiceTempPaths', () => {
  it('uses controlled temp paths for source and output audio', () => {
    const paths = buildVoiceTempPaths('D:/tmp/hira')

    expect(paths.source).toMatch(/music-voice[\\/].+\.audio$/)
    expect(paths.output).toMatch(/music-voice[\\/].+\.ogg$/)
  })
})
