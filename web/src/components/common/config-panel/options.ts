import type { ConfigFileKey, SelectOption } from './types'

export const booleanText = {
  enabled: '已开启',
  disabled: '已关闭'
}

export const configFiles: Array<{ key: ConfigFileKey; label: string; description: string }> = [
  { key: 'app', label: '基础', description: '总开关与命令' },
  { key: 'music', label: '点歌', description: '音乐源与 Cookie' },
  { key: 'resolver', label: '多平台解析', description: 'B站、抖音与兜底接口' },
  { key: 'runtime', label: '运行时', description: '缓存与媒体工具' },
  { key: 'light', label: '轻量', description: '轻量命令 API' },
  { key: 'translate', label: '翻译', description: '翻译接口' },
  { key: 'ai', label: 'AI', description: '网页总结' }
]

export const musicSourceOptions: SelectOption[] = [
  { label: '网易云', value: 'netease' },
  { label: 'QQ音乐', value: 'qq' },
  { label: '酷我', value: 'kuwo' },
  { label: '酷狗', value: 'kugou' },
  { label: '哔哩哔哩', value: 'bilibili' }
]

export const bilibiliQualityOptions: SelectOption[] = [
  { label: '360P 流畅', value: '16' },
  { label: '480P 清晰', value: '32' },
  { label: '720P 高清', value: '64' },
  { label: '1080P 高清', value: '80' },
  { label: '1080P+ 高码率', value: '112' },
  { label: '1080P60 高帧率', value: '116' },
  { label: '4K 超清', value: '120' }
]

export const bilibiliCodecOptions: SelectOption[] = [
  { label: '自动选择', value: 'auto' },
  { label: 'AVC/H.264 兼容', value: 'avc' },
  { label: 'HEVC/H.265', value: 'hevc' },
  { label: 'AV1', value: 'av1' }
]

export const douyinQualityOptions: SelectOption[] = [
  { label: '自动选择', value: 'adapt' },
  { label: '标清 540p', value: '540p' },
  { label: '高清 720p', value: '720p' },
  { label: '高清 1080p', value: '1080p' },
  { label: '超清 2K', value: '2k' },
  { label: '超清 4K', value: '4k' }
]

export const secondsToMinutes = (seconds: unknown) => {
  const value = Number(seconds)
  return Number.isFinite(value) ? value / 60 : 0
}

export const minutesToSeconds = (minutes: string) => {
  const value = Number(minutes)
  return Number.isFinite(value) ? Math.round(value * 60) : 0
}
