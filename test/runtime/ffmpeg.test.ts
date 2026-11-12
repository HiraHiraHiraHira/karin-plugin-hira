import { describe, expect, it } from 'vitest'

import { buildFfmpegArgs } from '@/runtime/ffmpeg'

describe('buildFfmpegArgs', () => {
  it('builds mp3 transcode args', () => {
    expect(buildFfmpegArgs({ input: 'in.m4s', output: 'out.mp3', format: 'mp3' })).toEqual([
      '-y',
      '-i',
      'in.m4s',
      '-vn',
      '-codec:a',
      'libmp3lame',
      '-b:a',
      '192k',
      'out.mp3'
    ])
  })

  it('builds voice-friendly mp3 args with sample rate and mono channel', () => {
    expect(buildFfmpegArgs({ input: 'in.mp3', output: 'out.mp3', format: 'voice' })).toContain('-ar')
    expect(buildFfmpegArgs({ input: 'in.mp3', output: 'out.mp3', format: 'voice' })).toContain('24000')
    expect(buildFfmpegArgs({ input: 'in.mp3', output: 'out.mp3', format: 'voice' })).toContain('-ac')
    expect(buildFfmpegArgs({ input: 'in.mp3', output: 'out.mp3', format: 'voice' })).toContain('1')
  })

  it('keeps the default low-quality voice args on mp3', () => {
    // 兜底产物用 mp3：Yogurt 的解码器不认 opus/ogg
    expect(buildFfmpegArgs({ input: 'in.mp3', output: 'out.mp3', format: 'voice' })).toEqual([
      '-y',
      '-i',
      'in.mp3',
      '-vn',
      '-ac',
      '1',
      '-codec:a',
      'libmp3lame',
      '-b:a',
      '32k',
      '-ar',
      '24000',
      'out.mp3'
    ])
  })

  it('builds high-quality voice args with stereo 48kHz 128kbps', () => {
    expect(buildFfmpegArgs({ input: 'in.mp3', output: 'out.mp3', format: 'voice', highQuality: true })).toEqual([
      '-y',
      '-i',
      'in.mp3',
      '-vn',
      '-ac',
      '2',
      '-codec:a',
      'libmp3lame',
      '-b:a',
      '128k',
      '-ar',
      '48000',
      'out.mp3'
    ])
  })

  it('builds stream-copy merge args for separated video and audio tracks', () => {
    expect(buildFfmpegArgs({
      videoInput: 'video.m4s',
      audioInput: 'audio.m4s',
      output: 'out.mp4',
      format: 'merge'
    })).toEqual([
      '-y',
      '-i',
      'video.m4s',
      '-stream_loop',
      '-1',
      '-i',
      'audio.m4s',
      '-map',
      '0:v:0',
      '-map',
      '1:a:0',
      '-c',
      'copy',
      '-shortest',
      'out.mp4'
    ])
  })

  it('builds QQ-compatible mp4 args with faststart and AAC-LC audio', () => {
    expect(buildFfmpegArgs({ input: 'raw.mp4', output: 'send.mp4', format: 'qq-video' })).toEqual([
      '-y',
      '-i',
      'raw.mp4',
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
      'send.mp4'
    ])
  })
})
