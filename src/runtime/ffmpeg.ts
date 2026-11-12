import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import { Config } from '@/config'

const execFileAsync = promisify(execFile)

export type FfmpegFormat = 'mp3' | 'voice' | 'wav' | 'copy' | 'merge' | 'qq-video'

export type FfmpegBuildOptions =
  | {
      input: string
      output: string
      format: Exclude<FfmpegFormat, 'merge' | 'voice'>
    }
  | {
      input: string
      output: string
      format: 'voice'
      /** 高音质：双声道 48kHz 128kbps，默认单声道 24kHz 32kbps */
      highQuality?: boolean
    }
  | {
      videoInput: string
      audioInput: string
      output: string
      format: 'merge'
    }

export const buildFfmpegArgs = (options: FfmpegBuildOptions) => {
  if (options.format === 'merge') {
    // 音轨(BGM)通常比视频片段长: 循环音频并以视频为终点截断, 否则容器时长取
    // 两者最大值, 用户会收到"画面早停、音乐继续"的长视频 (参考 R ffmpeg-util.js).
    return [
      '-y',
      '-i',
      options.videoInput,
      '-stream_loop',
      '-1',
      '-i',
      options.audioInput,
      '-map',
      '0:v:0',
      '-map',
      '1:a:0',
      '-c',
      'copy',
      '-shortest',
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

  if (options.format === 'wav') {
    // silk 编码器只吃 WAV: 单声道 24k 与 QQ 语音采样率一致, 免二次重采样.
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
      'pcm_s16le',
      options.output
    ]
  }

  if (options.format === 'voice') {
    // 兜底产物必须是 mp3：Yogurt（Milky 协议端）的解码器只认 mp3，
    // libopus 封出来的 ogg 会 no decoder found + audio processing failed。
    // NapCat 侧同样吃 mp3 语音，所以不必按协议分叉。
    return [
      '-y',
      '-i',
      options.input,
      '-vn',
      '-ac',
      options.highQuality ? '2' : '1',
      '-codec:a',
      'libmp3lame',
      '-b:a',
      options.highQuality ? '128k' : '32k',
      '-ar',
      options.highQuality ? '48000' : '24000',
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
