import { describe, expect, it } from 'vitest'

import { MusicSessionStore } from '@/music/session'
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
})
