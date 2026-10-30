import { describe, expect, it } from 'vitest'

import { MusicSessionStore, type MusicSessionListTarget } from '@/music/session'
import type { MusicItem } from '@/music/types'

const item = (id: string): MusicItem => ({
  id,
  source: 'netease',
  title: `song-${id}`,
  artists: ['Hira'],
  durationSeconds: 180,
  pageUrl: `https://example.test/${id}`
})

describe('MusicSessionStore', () => {
  it('stores and selects one-based items before expiration', () => {
    const store = new MusicSessionStore({ ttlMs: 1000, now: () => 1000 })

    store.set('group:1', [item('a'), item('b')], { keyword: '晴天', source: 'netease', page: 1 })

    expect(store.select('group:1', 2)).toMatchObject({ id: 'b' })
    expect(store.get('group:1')?.meta).toEqual({ keyword: '晴天', source: 'netease', page: 1 })
  })

  it('expires sessions and returns undefined for invalid indexes', () => {
    let now = 1000
    const store = new MusicSessionStore({ ttlMs: 1000, now: () => now })

    store.set('group:1', [item('a')], { keyword: '晴天', source: 'netease', page: 1 })

    expect(store.select('group:1', 0)).toBeUndefined()
    expect(store.select('group:1', 2)).toBeUndefined()

    now = 2501
    expect(store.get('group:1')).toBeUndefined()
    expect(store.select('group:1', 1)).toBeUndefined()
  })

  it('can resolve the TTL from current runtime configuration when creating a session', () => {
    let now = 1000
    let ttlMs = 1000
    const store = new MusicSessionStore({ getTtlMs: () => ttlMs, now: () => now })

    store.set('group:1', [item('a')], { keyword: '晴天', source: 'netease', page: 1 })
    ttlMs = 100
    now = 1501
    store.set('group:2', [item('b')], { keyword: '晴天', source: 'netease', page: 1 })
    now = 1602

    expect(store.get('group:1')).toMatchObject({ items: [{ id: 'a' }] })
    expect(store.get('group:2')).toBeUndefined()
  })

  it('remembers the last selected item', () => {
    const store = new MusicSessionStore({ ttlMs: 1000, now: () => 1000 })

    store.set('group:1', [item('a')], { keyword: '晴天', source: 'netease', page: 1 })
    store.select('group:1', 1)

    expect(store.getLastSelected('group:1')).toMatchObject({ id: 'a' })
  })

  it('caps the session count and evicts the oldest by expiry', () => {
    let now = 1000
    const store = new MusicSessionStore({ ttlMs: 10_000, now: () => now, maxSessions: 2 })

    store.set('group:1', [item('a')], { keyword: '晴天', source: 'netease', page: 1 })
    now += 1
    store.set('group:2', [item('b')], { keyword: '晴天', source: 'netease', page: 1 })
    now += 1
    store.set('group:3', [item('c')], { keyword: '晴天', source: 'netease', page: 1 })

    expect(store.size).toBe(2)
    expect(store.get('group:1')).toBeUndefined()
    expect(store.get('group:2')).toMatchObject({ items: [{ id: 'b' }] })
    expect(store.get('group:3')).toMatchObject({ items: [{ id: 'c' }] })
  })

  it('sweeps expired sessions so they do not count toward the cap', () => {
    let now = 1000
    const store = new MusicSessionStore({ ttlMs: 100, now: () => now, maxSessions: 2 })

    store.set('group:1', [item('a')], { keyword: '晴天', source: 'netease', page: 1 })
    store.set('group:2', [item('b')], { keyword: '晴天', source: 'netease', page: 1 })
    now = 2000

    expect(store.size).toBe(2)
    expect(store.sweep()).toBe(2)
    expect(store.size).toBe(0)

    store.set('group:3', [item('c')], { keyword: '晴天', source: 'netease', page: 1 })
    expect(store.size).toBe(1)
    expect(store.get('group:3')).toMatchObject({ items: [{ id: 'c' }] })
  })

  it('appends pages with continuous global indexes and renews TTL', () => {
    let now = 1000
    const store = new MusicSessionStore({ ttlMs: 1000, now: () => now })

    store.set('group:1', [item('a'), item('b')], { keyword: '晴天', source: 'netease', page: 1 })
    now = 1500
    const appended = store.appendPage('group:1', [item('c')], 2)

    expect(appended?.startIndex).toBe(3)
    // 跨页连续:第 3 首可直接发 3 点播
    expect(store.select('group:1', 3)).toMatchObject({ id: 'c' })
    expect(store.get('group:1')?.meta.page).toBe(2)
    // 续期:原 2000 到期,现 2500 才到期
    now = 2100
    expect(store.get('group:1')).toBeDefined()
    now = 2600
    expect(store.get('group:1')).toBeUndefined()
  })

  it('collects every page list message and recalls them all on expire', () => {
    const expired: MusicSessionListTarget[][] = []
    let now = 1000
    const store = new MusicSessionStore({ ttlMs: 1000, now: () => now, onExpire: (targets) => { expired.push(targets) } })

    store.set('group:1', [item('a')], { keyword: '晴天', source: 'netease', page: 1 })
    store.addListMessage('group:1', { contact: { scene: 'group', peer: 'g1', name: '群' }, selfId: 'bot', messageId: 'm1' })
    store.appendPage('group:1', [item('b')], 2)
    store.addListMessage('group:1', { contact: { scene: 'group', peer: 'g1', name: '群' }, selfId: 'bot', messageId: 'm2' })
    // 同一条重复登记只保留一份
    store.addListMessage('group:1', { contact: { scene: 'group', peer: 'g1', name: '群' }, selfId: 'bot', messageId: 'm2' })

    expect(store.takeListMessages('group:1').map(target => target.messageId)).toEqual(['m1', 'm2'])
    expect(store.takeListMessages('group:1')).toEqual([])

    store.addListMessage('group:1', { contact: { scene: 'group', peer: 'g1', name: '群' }, selfId: 'bot', messageId: 'm3' })
    now = 3500
    expect(store.get('group:1')).toBeUndefined()
    expect(expired).toHaveLength(1)
    expect(expired[0].map(target => target.messageId)).toEqual(['m3'])
  })

  it('sweeps expired sessions, recalls their list messages and keeps live ones', () => {
    const expired: MusicSessionListTarget[][] = []
    let now = 1000
    const store = new MusicSessionStore({ ttlMs: 1000, now: () => now, onExpire: (targets) => { expired.push(targets) } })

    store.set('group:1', [item('a')], { keyword: '晴天', source: 'netease', page: 1 })
    store.addListMessage('group:1', { contact: { scene: 'group', peer: 'g1', name: '群' }, selfId: 'bot', messageId: 'm1' })
    store.appendPage('group:1', [item('c')], 2)
    store.addListMessage('group:1', { contact: { scene: 'group', peer: 'g1', name: '群' }, selfId: 'bot', messageId: 'm2' })

    now = 1500
    store.set('group:2', [item('b')], { keyword: '晴天', source: 'netease', page: 1 })

    // group:1 在 2000 到期,group:2 在 2500 到期
    now = 2001
    expect(store.sweep()).toBe(1)
    expect(expired).toEqual([[
      { contact: { scene: 'group', peer: 'g1', name: '群' }, selfId: 'bot', messageId: 'm1' },
      { contact: { scene: 'group', peer: 'g1', name: '群' }, selfId: 'bot', messageId: 'm2' }
    ]])
    expect(store.get('group:1')).toBeUndefined()
    expect(store.get('group:2')).toMatchObject({ items: [{ id: 'b' }] })

    // 同一批会话重复扫描不得重复撤回
    expect(store.sweep()).toBe(0)
    expect(expired).toHaveLength(1)
  })

  it('sweeps sessions without a list message silently', () => {
    const expired: MusicSessionListTarget[][] = []
    let now = 1000
    const store = new MusicSessionStore({ ttlMs: 1000, now: () => now, onExpire: (targets) => { expired.push(targets) } })

    store.set('group:1', [item('a')], { keyword: '晴天', source: 'netease', page: 1 })

    now = 2001
    expect(store.sweep()).toBe(1)
    expect(expired).toHaveLength(0)
    // 无列表消息也应被清理,否则 Map 仍会随用户数增长
    expect(store.get('group:1')).toBeUndefined()
  })
})

