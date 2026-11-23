import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  FAVOURITES_CAP,
  type PinnedItem,
  RECENT_CAP,
  isPinned,
  parsePinned,
  pinKey,
  pinStorageKey,
  pushRecent,
  readPinned,
  refreshTitle,
  removePinned,
  resetPinnedStoreForTests,
  toggleFavourite,
  updatePinned,
} from './pinnedItems'

const item = (id: string, type: PinnedItem['type'] = 'defect', title = `Item ${id}`, at = 1): PinnedItem => ({
  type,
  id,
  title,
  url: `/x/${id}`,
  at,
})

describe('pinned items (pure)', () => {
  it('keys by type and id, and scopes storage by tenant and user', () => {
    expect(pinKey(item('1'))).toBe('defect:1')
    expect(pinKey(item('1', 'test_case'))).toBe('test_case:1')
    expect(pinStorageKey('favourites', 't1', 'u1')).toBe('qtesthub:favourites:t1:u1')
    expect(pinStorageKey('favourites', 't1', 'u2')).not.toBe(pinStorageKey('favourites', 't1', 'u1'))
    expect(pinStorageKey('recents', 't1', 'u1')).not.toBe(pinStorageKey('favourites', 't1', 'u1'))
  })

  it('toggles a favourite on and off, newest first, capped', () => {
    let list: PinnedItem[] = []
    list = toggleFavourite(list, item('1'))
    list = toggleFavourite(list, item('2'))
    expect(list.map((i) => i.id)).toEqual(['2', '1'])
    expect(isPinned(list, { type: 'defect', id: '1' })).toBe(true)
    list = toggleFavourite(list, item('1'))
    expect(list.map((i) => i.id)).toEqual(['2'])
    // The same id under another type is a different record.
    expect(isPinned(list, { type: 'project', id: '2' })).toBe(false)
    let many: PinnedItem[] = []
    for (let n = 0; n < FAVOURITES_CAP + 5; n++) many = toggleFavourite(many, item(String(n)))
    expect(many).toHaveLength(FAVOURITES_CAP)
  })

  it('records recents newest first without duplicates and caps at 8', () => {
    let list: PinnedItem[] = []
    for (let n = 0; n < 12; n++) list = pushRecent(list, item(String(n)))
    expect(list).toHaveLength(RECENT_CAP)
    expect(list[0].id).toBe('11')
    // Revisiting moves it to the front instead of duplicating.
    list = pushRecent(list, item('8'))
    expect(list.map((i) => i.id).slice(0, 3)).toEqual(['8', '11', '10'])
    expect(list).toHaveLength(RECENT_CAP)
  })

  it('returns the same array when the front item is unchanged (no storage rewrite)', () => {
    const list = pushRecent([], item('1'))
    expect(pushRecent(list, item('1', 'defect', 'Item 1', 99))).toBe(list)
    expect(pushRecent(list, item('1', 'defect', 'Renamed'))).not.toBe(list)
  })

  it('removes a stale entry and refreshes a renamed one', () => {
    const list = [item('1'), item('2')]
    expect(removePinned(list, 'defect:1').map((i) => i.id)).toEqual(['2'])
    expect(refreshTitle(list, item('2', 'defect', 'New name'))[1].title).toBe('New name')
    expect(refreshTitle(list, item('2'))).toBe(list)
  })

  it('reads damaged storage as empty and drops malformed or off-site entries', () => {
    expect(parsePinned(null)).toEqual([])
    expect(parsePinned('not json')).toEqual([])
    expect(parsePinned('{"a":1}')).toEqual([])
    const good = item('1')
    const raw = JSON.stringify([
      good,
      { ...item('2'), url: 'https://evil.example/x' },
      { ...item('3'), url: '//evil.example/x' },
      { ...item('4'), type: 'nonsense' },
      { id: 5 },
      null,
    ])
    expect(parsePinned(raw)).toEqual([good])
  })
})

describe('pinned items (store)', () => {
  beforeEach(() => {
    localStorage.clear()
    resetPinnedStoreForTests()
    vi.restoreAllMocks()
  })

  it('persists and keeps a stable snapshot until the stored list changes', () => {
    const key = pinStorageKey('favourites', 't', 'u')
    const first = readPinned(key)
    expect(readPinned(key)).toBe(first)
    updatePinned(key, (l) => toggleFavourite(l, item('1')))
    expect(readPinned(key).map((i) => i.id)).toEqual(['1'])
    expect(JSON.parse(localStorage.getItem(key)!)).toHaveLength(1)
    const again = readPinned(key)
    expect(readPinned(key)).toBe(again)
  })

  it('keeps working in memory when storage throws', () => {
    const key = pinStorageKey('recents', 't', 'u')
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    updatePinned(key, (l) => pushRecent(l, item('1')))
    expect(readPinned(key).map((i) => i.id)).toEqual(['1'])
  })

  it('two users on one browser keep separate lists', () => {
    const a = pinStorageKey('favourites', 't', 'ua')
    const b = pinStorageKey('favourites', 't', 'ub')
    updatePinned(a, (l) => toggleFavourite(l, item('1')))
    expect(readPinned(b)).toEqual([])
  })
})
