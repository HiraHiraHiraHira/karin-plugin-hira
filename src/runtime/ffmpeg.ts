import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import { Config } from '@/config'

const execFileAsync = promisify(execFile)

export type FfmpegFormat = 'mp3' | 'voice' | 'copy' | 'merge' | 'qq-video'

export type FfmpegBuildOptions =
  | {
      input: string
      output: string
      format: Exclude<FfmpegFormat, 'merge'>
    }
  | {
      videoInput: string
      audioInput: string
      output: string
      format: 'merge'
    }

export const buildFfmpegArgs = (options: FfmpegBuildOptions) => {
  if (options.format === 'merge') {
    return [
      '-y',
      '-i',
      options.videoInput,
      '-i',
      options.audioInput,
      '-map',
      '0:v:0',
      '-map',
      '1:a:0',
      '-c',
      'copy',
      options.output
    ]
  }

  if (options.format === 'copy') {
    return ['-y', '-i', options.input, '-c', 'copy', options.output]
  }

  if (options.format === 'qq-video') {
    return [
      '-y',
      '-i',
      options.input,
      '-map',
      '0:v:0',
      '-map',
      '0:a?',
      '-c:v',
      'copy',
      '-c:a',
      'aac',
      '-profile:a',
      'aac_low',
      '-b:a',
      '128k',
      '-movflags',
      '+faststart',
      options.output
    ]
  }

  if (options.format === 'voice') {
    return [
      '-y',
      '-i',
      options.input,
      '-vn',
      '-ac',
      '1',
      '-ar',
      '24000',
      '-codec:a',
      'libopus',
      '-b:a',
      '32k',
      options.output
    ]
  }

  return [
    '-y',
    '-i',
    options.input,
    '-vn',
    '-codec:a',
    'libmp3lame',
    '-b:a',
    '192k',
    options.output
  ]
}

export const runFfmpeg = async (options: FfmpegBuildOptions) => {
  await execFileAsync(Config.runtime.ffmpegPath || 'ffmpeg', buildFfmpegArgs(options), {
    windowsHide: true,
    timeout: Math.max(10, Config.runtime.downloadTimeoutSeconds) * 1000
  })
  return options.output
}

export const probeDurationSeconds = async (filePath: string) => {
  const { stdout } = await execFileAsync(Config.runtime.ffprobePath || 'ffprobe', [
    '-v',
    'error',
    '-show_entries',
    'format=duration',
    '-of',
    'default=noprint_wrappers=1:nokey=1',
    filePath
  ], {
    windowsHide: true,
    timeout: 10_000
  })
  const value = Number(stdout.trim())
  return Number.isFinite(value) ? value : undefined
}
