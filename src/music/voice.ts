import path from 'node:path'

import type { MusicPlayable } from '@/music/types'
import { downloadFile } from '@/runtime/downloader'
import { runFfmpeg } from '@/runtime/ffmpeg'
import { createTempFilePath, ensureTempDir, getTempRoot } from '@/runtime/temp'

export const buildVoiceTempPaths = (root = getTempRoot()) => {
  const dir = ensureTempDir(root, 'music-voice')
  return {
    source: path.join(dir, `${Date.now()}-${Math.random().toString(36).slice(2)}.audio`),
    output: path.join(dir, `${Date.now()}-${Math.random().toString(36).slice(2)}.ogg`)
  }
}

export const transcodePlayableToVoice = async (playable: MusicPlayable) => {
  const paths = buildVoiceTempPaths()
  await downloadFile({
    url: playable.audioUrl,
    output: paths.source
  })
  await runFfmpeg({
    input: paths.source,
    output: paths.output,
    format: 'voice'
  })
  return paths.output
}
