import fs from 'node:fs'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { Config } from '@/config'
import type { MusicPlayable } from '@/music/types'
import { buildVoiceTempPaths, isAmrAudioUrl, pcqqVoiceWarning, resolveVoiceFile, transcodePlayableToVoice, voiceUploadPlaceholder } from '@/music/voice'

const runtimeMocks = vi.hoisted(() => ({
  downloadFile: vi.fn(async (options: { output: string }) => options.output),
  runFfmpeg: vi.fn(async (options: { input: string, output: string, format: string }) => options.output),
  encodeSilkFile: vi.fn(async (input: string, output: string) => output)
}))

vi.mock('@/runtime/downloader', () => ({ downloadFile: runtimeMocks.downloadFile }))
vi.mock('@/runtime/ffmpeg', () => ({ runFfmpeg: runtimeMocks.runFfmpeg }))
vi.mock('@/music/silk', () => ({ encodeSilkFile: runtimeMocks.encodeSilkFile }))

// 隔离真实临时目录: 测试只验证路径形状与调用顺序, 不落盘.
vi.mock('@/runtime/temp', () => ({
  getTempRoot: () => 'D:/tmp/hira',
  ensureTempDir: (root: string, name: string) => `${root}/${name}`
}))

const playableOf = (audioUrl: string): MusicPlayable => ({
  item: { id: '1', source: 'qq', title: '晴天', artists: ['周杰伦'], pageUrl: 'https://example.test/song/1' },
  audioUrl
})

const resetRuntimeMocks = () => {
  vi.clearAllMocks()
  runtimeMocks.downloadFile.mockImplementation(async (options: { output: string }) => options.output)
  runtimeMocks.runFfmpeg.mockImplementation(async (options: { input: string, output: string, format: string }) => options.output)
  runtimeMocks.encodeSilkFile.mockImplementation(async (input: string, output: string) => output)
}

describe('buildVoiceTempPaths', () => {
  it('uses controlled temp paths for source, wav, silk, and mp3 fallback', () => {
    const paths = buildVoiceTempPaths('D:/tmp/hira')

    expect(paths.source).toMatch(/music-voice[\\/].+\.audio$/)
    expect(paths.wav).toMatch(/music-voice[\\/].+\.wav$/)
    expect(paths.silk).toMatch(/music-voice[\\/].+\.silk$/)
    expect(paths.output).toMatch(/music-voice[\\/].+\.mp3$/)
  })
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

describe('transcodePlayableToVoice', () => {
  afterEach(() => {
    resetRuntimeMocks()
    vi.restoreAllMocks()
  })

  it('限制音频下载体积并清理中间源文件', async () => {
    const rmSpy = vi.spyOn(fs, 'rmSync').mockImplementation(() => undefined as never)

    const result = await transcodePlayableToVoice(playableOf('https://example.test/a.mp3'))

    expect(runtimeMocks.downloadFile).toHaveBeenCalledWith(expect.objectContaining({
      url: 'https://example.test/a.mp3',
      maxBytes: Config.runtime.maxAudioFileSizeBytes
    }))
    expect(result).toMatch(/\.silk$/)
    // 源文件在 finally 里清掉
    expect(rmSpy).toHaveBeenCalledWith(expect.stringMatching(/\.audio$/), { force: true })
  })

  it('SILK 编码失败时回退 mp3', async () => {
    runtimeMocks.encodeSilkFile.mockRejectedValueOnce(new Error('wasm unavailable'))

    await expect(transcodePlayableToVoice(playableOf('https://example.test/a.mp3'))).resolves.toMatch(/\.mp3$/)
    expect(runtimeMocks.runFfmpeg).toHaveBeenLastCalledWith(expect.objectContaining({
      format: 'voice',
      highQuality: undefined
    }))
  })

  it('转码失败时清理源文件与半成品输出', async () => {
    const rmSpy = vi.spyOn(fs, 'rmSync').mockImplementation(() => undefined as never)
    runtimeMocks.runFfmpeg.mockRejectedValue(new Error('ffmpeg 转码失败'))
    runtimeMocks.encodeSilkFile.mockRejectedValue(new Error('silk 不可用'))

    await expect(transcodePlayableToVoice(playableOf('https://example.test/a.mp3'))).rejects.toThrow('ffmpeg 转码失败')

    expect(rmSpy).toHaveBeenCalledWith(expect.stringMatching(/\.wav$/), { force: true })
    expect(rmSpy).toHaveBeenCalledWith(expect.stringMatching(/\.silk$/), { force: true })
    expect(rmSpy).toHaveBeenCalledWith(expect.stringMatching(/\.mp3$/), { force: true })
    expect(rmSpy).toHaveBeenCalledWith(expect.stringMatching(/\.audio$/), { force: true })
  })
})

describe('resolveVoiceFile', () => {
  afterEach(() => {
    resetRuntimeMocks()
  })

  it('returns undefined for high-quality sources so the sender uploads the original audio', async () => {
    await expect(resolveVoiceFile(playableOf('https://example.test/a.mp3'), { highQuality: true })).resolves.toBeUndefined()
    expect(runtimeMocks.downloadFile).not.toHaveBeenCalled()
    expect(runtimeMocks.runFfmpeg).not.toHaveBeenCalled()
    expect(runtimeMocks.encodeSilkFile).not.toHaveBeenCalled()
  })

  it('encodes normal voice to SILK through a 24k mono wav', async () => {
    const result = await resolveVoiceFile(playableOf('https://example.test/a.mp3'))

    expect(result).toMatch(/\.silk$/)
    expect(runtimeMocks.downloadFile).toHaveBeenCalledWith(expect.objectContaining({
      url: 'https://example.test/a.mp3',
      output: expect.stringMatching(/\.audio$/)
    }))
    expect(runtimeMocks.runFfmpeg).toHaveBeenCalledWith({
      input: expect.stringMatching(/\.audio$/),
      output: expect.stringMatching(/\.wav$/),
      format: 'wav'
    })
    expect(runtimeMocks.encodeSilkFile).toHaveBeenCalledWith(
      expect.stringMatching(/\.wav$/),
      expect.stringMatching(/\.silk$/)
    )
    expect(result).toBe(runtimeMocks.encodeSilkFile.mock.calls[0]?.[1])
  })

  it('falls back to mp3 when silk encoding is unavailable', async () => {
    runtimeMocks.encodeSilkFile.mockRejectedValueOnce(new Error('wasm unavailable'))

    const result = await resolveVoiceFile(playableOf('https://example.test/a.mp3'))

    expect(result).toMatch(/\.mp3$/)
    expect(runtimeMocks.runFfmpeg).toHaveBeenLastCalledWith(expect.objectContaining({ format: 'voice' }))
  })
})