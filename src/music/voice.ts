import fs from 'node:fs'
import path from 'node:path'

import { Config } from '@/config'
import { formatArtists } from '@/music/providers/helpers'
import type { MusicPlayable } from '@/music/types'
import { downloadFile } from '@/runtime/downloader'
import { runFfmpeg } from '@/runtime/ffmpeg'
import { ensureTempDir, getTempRoot } from '@/runtime/temp'

export const buildVoiceTempPaths = (root = getTempRoot()) => {
  const dir = ensureTempDir(root, 'music-voice')
  return {
    source: path.join(dir, `${Date.now()}-${Math.random().toString(36).slice(2)}.audio`),
    output: path.join(dir, `${Date.now()}-${Math.random().toString(36).slice(2)}.ogg`)
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

/**
 * 解析语音上行文件.
 * - 高清 (`highQuality`) 且音源本身是 amr: 返回 `undefined`, 由 `replyVoiceFileOrAudio`
 *   直传 `playable.audioUrl`. amr 是 QQ 语音端原生格式, 免去二次有损转码.
 * - 其余情况(含高清但非 amr, 例如网易云 lossless 直出的 mp3): 下载后转 opus ogg
 *   单声道 24k, `segment.record` 端可播; 转码失败时抛给调用方走直链兜底.
 *
 * 不变量: 只有 amr 可以免转码直传. 其它格式(尤其 mp3/flac)直传会在 QQ 语音端不可播,
 * 所以高清不能作为"跳过转码"的唯一条件.
 */
export const resolveVoiceFile = async (playable: MusicPlayable, options?: { highQuality?: boolean }) => {
  if (options?.highQuality && isAmrAudioUrl(playable.audioUrl)) return undefined
  return transcodePlayableToVoice(playable, options)
}
