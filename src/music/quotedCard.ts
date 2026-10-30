/** 引用消息里的音乐分享卡片(QQ/网易云 json 卡片). */
export type QuotedMusicCard = {
  title: string
  desc: string
  musicUrl: string
  jumpUrl?: string
}

const asRecord = (value: unknown): Record<string, unknown> | undefined => {
  return value && typeof value === 'object' ? value as Record<string, unknown> : undefined
}

/**
 * 从消息元素里取引用段的 messageId: 引用段只带 id, 正文要再用 getMsg 取一次.
 * 与 apps/translate 的读取方式一致.
 */
export const findQuotedMessageId = (elements: unknown): string | undefined => {
  if (!Array.isArray(elements)) return undefined
  for (const el of elements) {
    if (!el || typeof el !== 'object') continue
    const record = el as Record<string, unknown>
    if (record.type === 'reply' && typeof record.messageId === 'string' && record.messageId) {
      return record.messageId
    }
  }
  return undefined
}

/** getMsg 的正文在 elements; 旧适配器只给 message. */
export const readMessageElements = (message: unknown): unknown[] | undefined => {
  const record = asRecord(message)
  if (!record) return undefined
  for (const key of ['elements', 'message']) {
    const value = record[key]
    if (Array.isArray(value)) return value
  }
  return undefined
}

/**
 * 解析 json 段的音乐卡片. 云崽只看 `view === 'music'` 的 `meta.music`.
 * 这里接受 data 为字符串或对象, 并容忍跳转链接缺失.
 */
export const extractQuotedMusicCard = (elements: unknown): QuotedMusicCard | undefined => {
  if (!Array.isArray(elements)) return undefined

  for (const el of elements) {
    const record = asRecord(el)
    if (record?.type !== 'json') continue

    const raw = record.data
    let payload: unknown = raw
    if (typeof raw === 'string') {
      try {
        payload = JSON.parse(raw)
      } catch {
        continue
      }
    }

    const card = asRecord(payload)
    const music = asRecord(asRecord(card?.meta)?.music)
    const musicUrl = typeof music?.musicUrl === 'string' ? music.musicUrl : ''
    if (card?.view !== 'music' || !musicUrl.trim()) continue

    return {
      title: typeof music?.title === 'string' && music.title.trim() ? music.title : '未知歌曲',
      desc: typeof music?.desc === 'string' ? music.desc : '',
      musicUrl,
      ...(typeof music?.jumpUrl === 'string' && music.jumpUrl ? { jumpUrl: music.jumpUrl } : {})
    }
  }

  return undefined
}
