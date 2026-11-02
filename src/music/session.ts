import type { MusicItem, MusicSessionMeta } from './types'

type Session = {
  items: MusicItem[]
  meta: MusicSessionMeta
  expiresAt: number
  lastSelected?: MusicItem
}

type StoreOptions = {
  ttlMs?: number
  getTtlMs?: () => number
  now?: () => number
  maxSessions?: number
}

/** 内存中最多保留的会话数，超出后按 expiresAt 最旧淘汰，避免只增不减 */
const defaultMaxSessions = 500

export class MusicSessionStore {
  private readonly getTtlMs: () => number
  private readonly now: () => number
  private readonly maxSessions: number
  private readonly sessions = new Map<string, Session>()

  constructor(options: StoreOptions) {
    this.getTtlMs = options.getTtlMs ?? (() => options.ttlMs ?? 0)
    this.now = options.now ?? Date.now
    this.maxSessions = Math.max(1, options.maxSessions ?? defaultMaxSessions)
  }

  /** 当前保留的会话数量，主要供容量/清扫观测 */
  get size() {
    return this.sessions.size
  }

  set(key: string, items: MusicItem[], meta: MusicSessionMeta) {
    this.sessions.set(key, {
      items,
      meta,
      expiresAt: this.now() + Math.max(0, this.getTtlMs())
    })
    this.evictOverflow()
  }

  get(key: string) {
    const session = this.sessions.get(key)
    if (!session) return undefined
    if (session.expiresAt <= this.now()) {
      this.sessions.delete(key)
      return undefined
    }
    return session
  }

  select(key: string, oneBasedIndex: number) {
    const session = this.get(key)
    if (!session || oneBasedIndex < 1) return undefined

    const item = session.items[oneBasedIndex - 1]
    if (!item) return undefined

    session.lastSelected = item
    return item
  }

  getLastSelected(key: string) {
    return this.get(key)?.lastSelected
  }

  /** 清掉所有已过期会话，返回清理数量 */
  sweep() {
    const now = this.now()
    let removed = 0
    for (const [key, session] of this.sessions) {
      if (session.expiresAt <= now) {
        this.sessions.delete(key)
        removed++
      }
    }
    return removed
  }

  // 超过上限时先清扫过期条目，仍超限再按 expiresAt 最旧删掉多余条目
  private evictOverflow() {
    if (this.sessions.size <= this.maxSessions) return
    this.sweep()
    if (this.sessions.size <= this.maxSessions) return

    const overflow = this.sessions.size - this.maxSessions
    const oldest = [...this.sessions.entries()]
      .sort((a, b) => a[1].expiresAt - b[1].expiresAt)
      .slice(0, overflow)
    for (const [key] of oldest) this.sessions.delete(key)
  }
}
