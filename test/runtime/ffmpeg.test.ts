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

  it('builds voice-friendly opus args with sample rate and mono channel', () => {
    expect(buildFfmpegArgs({ input: 'in.mp3', output: 'out.ogg', format: 'voice' })).toContain('-ar')
    expect(buildFfmpegArgs({ input: 'in.mp3', output: 'out.ogg', format: 'voice' })).toContain('24000')
    expect(buildFfmpegArgs({ input: 'in.mp3', output: 'out.ogg', format: 'voice' })).toContain('-ac')
    expect(buildFfmpegArgs({ input: 'in.mp3', output: 'out.ogg', format: 'voice' })).toContain('1')
  })

  it('keeps the default low-quality voice args unchanged', () => {
    expect(buildFfmpegArgs({ input: 'in.mp3', output: 'out.ogg', format: 'voice' })).toEqual([
      '-y',
      '-i',
      'in.mp3',
      '-vn',
      '-ac',
      '1',
      '-ar',
      '24000',
      '-codec:a',
      'libopus',
      '-b:a',
      '32k',
      'out.ogg'
    ])
  })

  it('builds high-quality voice args with stereo 48kHz 128kbps', () => {
    expect(buildFfmpegArgs({ input: 'in.mp3', output: 'out.ogg', format: 'voice', highQuality: true })).toEqual([
      '-y',
      '-i',
      'in.mp3',
      '-vn',
      '-ac',
      '2',
      '-ar',
      '48000',
      '-codec:a',
      'libopus',
      '-b:a',
      '128k',
      'out.ogg'
    ])
  })

  it('builds stream-copy merge args for separated video and audio tracks', () => {
    expect(buildFfmpegArgs({
      videoInput: 'video.m4s',
      audioInput: 'audio.m4s',
      output: 'out.mp4',
      format: 'merge'
    } as any)).toEqual([
      '-y',
      '-i',
      'video.m4s',
      '-i',
      'audio.m4s',
      '-map',
      '0:v:0',
      '-map',
      '1:a:0',
      '-c',
      'copy',
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
