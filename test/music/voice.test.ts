import fs from 'node:fs'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { Config } from '@/config'
import type { MusicPlayable } from '@/music/types'
import { buildVoiceTempPaths, isAmrAudioUrl, pcqqVoiceWarning, resolveVoiceFile, transcodePlayableToVoice, voiceUploadPlaceholder } from '@/music/voice'

const runtimeMocks = vi.hoisted(() => ({
  downloadFile: vi.fn(async (options: { output: string }) => options.output),
  runFfmpeg: vi.fn(async (options: { input: string, output: string, format: string }) => options.output)
}))

vi.mock('@/runtime/downloader', () => ({ downloadFile: runtimeMocks.downloadFile }))
vi.mock('@/runtime/ffmpeg', () => ({ runFfmpeg: runtimeMocks.runFfmpeg }))

const playable: MusicPlayable = {
  item: { id: '1', source: 'netease', title: '测试歌曲', artists: [], pageUrl: 'https://example.test/song' },
  audioUrl: 'https://cdn.example.test/a.mp3'
}

describe('buildVoiceTempPaths', () => {
  it('uses controlled temp paths for source and output audio', () => {
    const paths = buildVoiceTempPaths('D:/tmp/hira')

    expect(paths.source).toMatch(/music-voice[\\/].+\.audio$/)
    expect(paths.output).toMatch(/music-voice[\\/].+\.ogg$/)
  })
})

describe('transcodePlayableToVoice', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('限制音频下载体积并清理中间源文件', async () => {
    let sourcePath = ''
    runtimeMocks.downloadFile.mockImplementation(async (options: { output: string }) => {
      sourcePath = options.output
      fs.writeFileSync(options.output, 'audio-bytes')
      return options.output
    })
    let outputPath = ''
    runtimeMocks.runFfmpeg.mockImplementation(async (options: { output: string }) => {
      outputPath = options.output
      fs.writeFileSync(options.output, 'ogg-bytes')
      return options.output
    })

    const result = await transcodePlayableToVoice(playable)

    expect(runtimeMocks.downloadFile).toHaveBeenCalledWith(expect.objectContaining({
      url: playable.audioUrl,
      maxBytes: Config.runtime.maxAudioFileSizeBytes
    }))
    expect(runtimeMocks.runFfmpeg).toHaveBeenCalledTimes(1)
    expect((runtimeMocks.runFfmpeg.mock.calls[0]![0] as { format: string }).format).toBe('voice')
    expect((runtimeMocks.runFfmpeg.mock.calls[0]![0] as { highQuality?: boolean }).highQuality).toBeUndefined()
    expect(result).toBe(outputPath)
    expect(fs.existsSync(result)).toBe(true)
    expect(sourcePath).not.toBe('')
    expect(fs.existsSync(sourcePath)).toBe(false)

    fs.rmSync(result, { force: true })
  })

  it('转码失败时清理源文件与半成品输出', async () => {
    let sourcePath = ''
    runtimeMocks.downloadFile.mockImplementation(async (options: { output: string }) => {
      sourcePath = options.output
      fs.writeFileSync(options.output, 'audio-bytes')
      return options.output
    })
    let outputPath = ''
    runtimeMocks.runFfmpeg.mockImplementation(async (options: { output: string }) => {
      outputPath = options.output
      fs.writeFileSync(options.output, 'partial-ogg')
      throw new Error('ffmpeg 转码失败')
    })

    await expect(transcodePlayableToVoice(playable)).rejects.toThrow('ffmpeg 转码失败')

    expect(sourcePath).not.toBe('')
    expect(fs.existsSync(sourcePath)).toBe(false)
    expect(fs.existsSync(outputPath)).toBe(false)
  })

  it('高音质选项透传给 ffmpeg', async () => {
    runtimeMocks.downloadFile.mockImplementation(async (options: { output: string }) => {
      fs.writeFileSync(options.output, 'audio-bytes')
      return options.output
    })
    runtimeMocks.runFfmpeg.mockImplementation(async (options: { output: string }) => {
      fs.writeFileSync(options.output, 'ogg-bytes')
      return options.output
    })

    const result = await transcodePlayableToVoice(playable, { highQuality: true })

    expect((runtimeMocks.runFfmpeg.mock.calls[0]![0] as { highQuality?: boolean }).highQuality).toBe(true)
    fs.rmSync(result, { force: true })
  })
})

const playableOf = (audioUrl: string): MusicPlayable => ({
  item: { id: '1', source: 'qq', title: '晴天', artists: ['周杰伦'], pageUrl: 'https://example.test/song/1' },
  audioUrl
})

describe('voiceUploadPlaceholder', () => {
  it('builds the upload placeholder copy', () => {
    expect(voiceUploadPlaceholder(playableOf('https://example.test/a.mp3'))).toBe('开始上传[晴天-周杰伦]…')
  })
})

describe('isAmrAudioUrl', () => {
  it('detects amr audio urls', () => {
    expect(isAmrAudioUrl('https://example.test/a.amr')).toBe(true)
    expect(isAmrAudioUrl('https://example.test/a.amr?x=1')).toBe(true)
    expect(isAmrAudioUrl('https://example.test/a.mp3')).toBe(false)
  })
})

describe('pcqqVoiceWarning', () => {
  it('mentions PCQQ compatibility', () => {
    expect(pcqqVoiceWarning(playableOf('https://example.test/a.amr'))).toContain('PCQQ')
  })
})

describe('resolveVoiceFile', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('returns undefined only for high-quality amr sources that need no transcoding', async () => {
    await expect(resolveVoiceFile(playableOf('https://example.test/a.amr'), { highQuality: true })).resolves.toBeUndefined()
    expect(runtimeMocks.downloadFile).not.toHaveBeenCalled()
    expect(runtimeMocks.runFfmpeg).not.toHaveBeenCalled()
  })

  it('transcodes high-quality mp3 sources instead of direct-uploading them', async () => {
    const result = await resolveVoiceFile(playableOf('https://example.test/a.mp3'), { highQuality: true })

    expect(result).toMatch(/\.ogg$/)
    expect(runtimeMocks.downloadFile).toHaveBeenCalledWith(expect.objectContaining({
      url: 'https://example.test/a.mp3',
      output: expect.stringMatching(/\.audio$/)
    }))
    const ffmpegOptions = runtimeMocks.runFfmpeg.mock.calls[0]?.[0]
    expect(ffmpegOptions).toMatchObject({
      input: expect.stringMatching(/\.audio$/),
      output: expect.stringMatching(/\.ogg$/),
      format: 'voice'
    })
    expect(result).toBe(ffmpegOptions?.output)
  })

  it('transcodes non high-quality amr sources as well', async () => {
    await expect(resolveVoiceFile(playableOf('https://example.test/a.amr'))).resolves.toMatch(/\.ogg$/)
    expect(runtimeMocks.runFfmpeg).toHaveBeenCalledWith(expect.objectContaining({ format: 'voice' }))
  })
})
