import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { pinStorageKey, resetPinnedStoreForTests } from './pinnedItems'

let currentUser: { tenant_id: string; user_id: string } | null = { tenant_id: 't1', user_id: 'u1' }
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ user: currentUser }) }))

import { useFavourites } from './useFavourites'
import { useRecents, useTrackRecent } from './useRecents'

const base = { type: 'test_case' as const, id: 'c1', title: 'Verify claim', url: '/test-cases/c1' }

beforeEach(() => {
  localStorage.clear()
  resetPinnedStoreForTests()
  currentUser = { tenant_id: 't1', user_id: 'u1' }
})

describe('useFavourites', () => {
  it('toggles, persists per tenant and user, and updates every consumer at once', () => {
    const a = renderHook(() => useFavourites())
    const b = renderHook(() => useFavourites())
    expect(a.result.current.has('test_case', 'c1')).toBe(false)
    act(() => a.result.current.toggle(base))
    expect(a.result.current.has('test_case', 'c1')).toBe(true)
    // The sidebar (another hook instance) sees the star toggled on the page.
    expect(b.result.current.items.map((i) => i.title)).toEqual(['Verify claim'])
    expect(JSON.parse(localStorage.getItem(pinStorageKey('favourites', 't1', 'u1'))!)).toHaveLength(1)
    act(() => a.result.current.remove('test_case:c1'))
    expect(b.result.current.items).toEqual([])
  })

  it('another user on the same browser sees none of it', () => {
    const a = renderHook(() => useFavourites())
    act(() => a.result.current.toggle(base))
    currentUser = { tenant_id: 't1', user_id: 'u2' }
    const other = renderHook(() => useFavourites())
    expect(other.result.current.items).toEqual([])
  })

  it('does nothing without a signed-in user', () => {
    currentUser = null
    const { result } = renderHook(() => useFavourites())
    act(() => result.current.toggle(base))
    expect(result.current.items).toEqual([])
    expect(localStorage.length).toBe(0)
  })
})

describe('useRecents', () => {
  it('records a visit once the title is known, and not while loading', () => {
    const { result, rerender } = renderHook(
      ({ item }: { item: typeof base | null }) => {
        useTrackRecent(item)
        return useRecents()
      },
      { initialProps: { item: null as typeof base | null } },
    )
    expect(result.current.items).toEqual([])
    rerender({ item: base })
    expect(result.current.items.map((i) => i.id)).toEqual(['c1'])
    rerender({ item: base })
    expect(result.current.items).toHaveLength(1)
  })

  it('lets the user remove a stale entry', () => {
    const { result } = renderHook(() => useRecents())
    act(() => result.current.record(base))
    act(() => result.current.remove('test_case:c1'))
    expect(result.current.items).toEqual([])
  })
})
