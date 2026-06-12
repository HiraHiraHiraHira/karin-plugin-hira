import type { MusicItem, MusicSessionMeta } from './types'

type Session = {
  items: MusicItem[]
  meta: MusicSessionMeta
  expiresAt: number
  lastSelected?: MusicItem
}

type StoreOptions = {
  ttlMs: number
  now?: () => number
}

export class MusicSessionStore {
  private readonly ttlMs: number
  private readonly now: () => number
  private readonly sessions = new Map<string, Session>()

  constructor(options: StoreOptions) {
    this.ttlMs = options.ttlMs
    this.now = options.now ?? Date.now
  }

  set(key: string, items: MusicItem[], meta: MusicSessionMeta) {
    this.sessions.set(key, {
      items,
      meta,
      expiresAt: this.now() + this.ttlMs
    })
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
}
