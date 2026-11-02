import fs from 'node:fs'
import path from 'node:path'

import { Config } from '@/config'
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

export const transcodePlayableToVoice = async (playable: MusicPlayable, options: { highQuality?: boolean } = {}) => {
  const paths = buildVoiceTempPaths()
  try {
    await downloadFile({
      url: playable.audioUrl,
      output: paths.source,
      maxBytes: Config.runtime.maxAudioFileSizeBytes
    })
    await runFfmpeg({
      input: paths.source,
      output: paths.output,
      format: 'voice',
      highQuality: options.highQuality
    })
    return paths.output
  } catch (error) {
    // 转码失败时不留下半成品音频
    fs.rmSync(paths.output, { force: true })
    throw error
  } finally {
    // 无论成功失败都清掉中间源文件，避免每次语音点歌残留两个文件
    fs.rmSync(paths.source, { force: true })
  }
}
