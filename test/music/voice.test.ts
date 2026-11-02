import fs from 'node:fs'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { Config } from '@/config'
import type { MusicPlayable } from '@/music/types'
import { buildVoiceTempPaths, transcodePlayableToVoice } from '@/music/voice'

const runtimeMocks = vi.hoisted(() => ({
  downloadFile: vi.fn(),
  runFfmpeg: vi.fn()
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
