import fs from 'node:fs'
import path from 'node:path'

import { Config } from '@/config'
import { formatArtists } from '@/music/providers/helpers'
import { encodeSilkFile } from '@/music/silk'
import type { MusicPlayable } from '@/music/types'
import { downloadFile } from '@/runtime/downloader'
import { runFfmpeg } from '@/runtime/ffmpeg'
import { ensureTempDir, getTempRoot } from '@/runtime/temp'

export const buildVoiceTempPaths = (root = getTempRoot()) => {
  const dir = ensureTempDir(root, 'music-voice')
  const base = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`
  return {
    source: path.join(dir, `${base()}.audio`),
    wav: path.join(dir, `${base()}.wav`),
    silk: path.join(dir, `${base()}.silk`),
    /** silk 不可用时的 opus 兜底产物 */
    output: path.join(dir, `${base()}.ogg`)
  }
}

/** 语音展示标签, 占位文案与日志共用: `[歌名-歌手]`. */
export const voiceFileLabel = (playable: MusicPlayable) =>
  `[${playable.item.title}-${formatArtists(playable.item.artists)}]`

/** 上传前占位文案: `开始上传[歌名-歌手]…`. */
export const voiceUploadPlaceholder = (playable: MusicPlayable) => `开始上传${voiceFileLabel(playable)}…`

/** 高清语音发送后的 PCQQ 兼容提示, 需引用发出. */
export const pcqqVoiceWarning = (playable: MusicPlayable) =>
  `${voiceFileLabel(playable)} 高清语音已发送, PCQQ 可能无法播放, 请用手机 QQ 收听.`

export const isAmrAudioUrl = (url: string) => /\.amr(?:[?#]|$)/i.test(url)

/**
 * 普通语音: 下载 → WAV(24k 单声道) → SILK.
 * SILK 是 QQ 语音端原生格式, 发送后是真语音条(等价云崽 uploadRecord 的转码路径).
 * silk-wasm 不可用时退回 opus ogg, 保证至少能发出语音.
 */
export const transcodePlayableToVoice = async (playable: MusicPlayable, options: { highQuality?: boolean } = {}) => {
  const paths = buildVoiceTempPaths()
  try {
    await downloadFile({
      url: playable.audioUrl,
      output: paths.source,
      maxBytes: Config.runtime.maxAudioFileSizeBytes
    })

    try {
      await runFfmpeg({
        input: paths.source,
        output: paths.wav,
        format: 'wav'
      })
      return await encodeSilkFile(paths.wav, paths.silk)
    } catch {
      await runFfmpeg({
        input: paths.source,
        output: paths.output,
        format: 'voice',
        highQuality: options.highQuality
      })
      return paths.output
    }
  } catch (error) {
    // 转码失败时不留下半成品音频
    for (const file of [paths.wav, paths.silk, paths.output]) fs.rmSync(file, { force: true })
    throw error
  } finally {
    // 无论成功失败都清掉中间源文件，避免每次语音点歌残留两个文件
    fs.rmSync(paths.source, { force: true })
  }
}

/**
 * 解析语音上行文件.
 * - 高清 (`highQuality`): 返回 `undefined`, 由 `replyVoiceFileOrAudio` 直传原音质直链
 *   (等价云崽 uploadRecord 的 `transcoding=false`); 直传失败由调用方降级到 SILK.
 * - 普通语音: 转成 SILK 真语音条.
 *
 * 不变量: 高清才允许直传原音质; 普通语音必须转码成语音端原生格式.
 * 失败时抛给调用方走直链兜底.
 */
export const resolveVoiceFile = async (playable: MusicPlayable, options?: { highQuality?: boolean }) => {
  if (options?.highQuality) return undefined
  return transcodePlayableToVoice(playable, options)
}
