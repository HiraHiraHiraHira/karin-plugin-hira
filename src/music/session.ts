import type { Message } from 'node-karin'

import type { MusicItem, MusicSessionMeta } from './types'

/** 可撤回的列表消息定位:发出会话的联系人与 Bot */
export type MusicSessionListTarget = {
  contact: Message['contact']
  selfId: string
  messageId: string
}

type Session = {
  items: MusicItem[]
  meta: MusicSessionMeta
  expiresAt: number
  /** items[0] 对应的全局序号(1-based);翻页追加后保持跨页连续 */
  startIndex: number
  lastSelected?: MusicItem
  /** 已发出、待撤回的列表消息(翻页会累加, 换歌/过期时整批撤回) */
  listMessages: MusicSessionListTarget[]
}

type StoreOptions = {
  ttlMs?: number
  getTtlMs?: () => number
  now?: () => number
  maxSessions?: number
  /** 会话过期被清理时触发(同步触发,内部自行处理异步撤回) */
  onExpire?: (targets: MusicSessionListTarget[]) => void
}

/** 内存中最多保留的会话数，超出后按 expiresAt 最旧淘汰，避免只增不减 */
const defaultMaxSessions = 500

export class MusicSessionStore {
  private readonly getTtlMs: () => number
  private readonly now: () => number
  private readonly maxSessions: number
  private readonly onExpire?: (targets: MusicSessionListTarget[]) => void
  private readonly sessions = new Map<string, Session>()

  constructor(options: StoreOptions) {
    this.getTtlMs = options.getTtlMs ?? (() => options.ttlMs ?? 0)
    this.now = options.now ?? Date.now
    this.maxSessions = Math.max(1, options.maxSessions ?? defaultMaxSessions)
    this.onExpire = options.onExpire
  }

  /** 当前保留的会话数量，主要供容量/清扫观测 */
  get size() {
    return this.sessions.size
  }

  set(key: string, items: MusicItem[], meta: MusicSessionMeta) {
    this.sessions.set(key, {
      items: [...items],
      meta,
      expiresAt: this.now() + Math.max(0, this.getTtlMs()),
      startIndex: 1,
      listMessages: []
    })
    this.evictOverflow()
  }

  /**
   * 追加下一页并续期 TTL,返回新页的全局起始序号.
   * 会话缺失或已过期时返回 undefined.
   */
  appendPage(key: string, items: MusicItem[], page: number) {
    const session = this.takeIfAlive(key)
    if (!session) return undefined
    const startIndex = session.startIndex + session.items.length
    session.items.push(...items)
    session.meta = { ...session.meta, page }
    session.expiresAt = this.now() + Math.max(0, this.getTtlMs())
    return { startIndex, items }
  }

  get(key: string) {
    return this.takeIfAlive(key)
  }

  /** 按全局序号(跨页连续)取歌,越界返回 undefined */
  select(key: string, oneBasedIndex: number) {
    const session = this.takeIfAlive(key)
    if (!session || oneBasedIndex < session.startIndex) return undefined
    const item = session.items[oneBasedIndex - session.startIndex]
    if (!item) return undefined
    session.lastSelected = item
    return item
  }

  getLastSelected(key: string) {
    return this.takeIfAlive(key)?.lastSelected
  }

  /** 记录刚发出的列表消息,用于换歌/过期时整批撤回(翻页会保留旧页的 id) */
  addListMessage(key: string, target: MusicSessionListTarget) {
    const session = this.takeIfAlive(key)
    if (!session) return
    if (session.listMessages.some(item => item.messageId === target.messageId)) return
    session.listMessages.push(target)
  }

  /** 取出本会话所有待撤回的列表消息并清空(每条只撤一次) */
  takeListMessages(key: string) {
    const session = this.takeIfAlive(key)
    if (!session || session.listMessages.length === 0) return []
    const targets = session.listMessages
    session.listMessages = []
    return targets
  }

  /**
   * 主动清理所有已过期会话并返回清理条数.
   * 由定时器调用:否则过期会话只有在用户再次交互时才会被发现,
   * 列表卡片不会按时撤回,Map 也会随用户数无限增长.
   */
  sweep() {
    let removed = 0
    for (const [key, session] of this.sessions) {
      if (session.expiresAt > this.now()) continue
      this.expire(key, session)
      removed += 1
    }
    return removed
  }

  private takeIfAlive(key: string) {
    const session = this.sessions.get(key)
    if (!session) return undefined
    if (session.expiresAt <= this.now()) {
      this.expire(key, session)
      return undefined
    }
    return session
  }

  /**
   * 删除会话,列表消息可定位时触发一次过期回调.
   * takeIfAlive 与 sweep 共用,保证两条路径的撤回语义一致.
   */
  private expire(key: string, session: Session) {
    this.sessions.delete(key)
    // 没有列表消息时无需撤回,直接丢弃会话
    if (session.listMessages.length === 0) return
    // 提前置空,即便回调抛错后同对象再次进入 expire 也不会重复撤回
    const targets = session.listMessages
    session.listMessages = []
    try {
      this.onExpire?.(targets)
    } catch {
      // 忽略过期回调异常,会话清理本身不受影响
    }
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
