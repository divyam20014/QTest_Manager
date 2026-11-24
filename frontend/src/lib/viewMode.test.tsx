import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/auth', () => ({ useAuth: () => ({ user: { user_id: 'u1', tenant_id: 't1' } }) }))

import { parseViewMode, resolveViewMode, useViewMode, viewModeStorageKey } from './viewMode'

const ALL = ['list', 'board', 'calendar'] as const
const wrapper = (initial: string) =>
  function Wrapper({ children }: { children: ReactNode }) {
    return <MemoryRouter initialEntries={[initial]}>{children}</MemoryRouter>
  }

beforeEach(() => localStorage.clear())

describe('view mode', () => {
  it('parses only the modes a list offers', () => {
    expect(parseViewMode('board', ALL)).toBe('board')
    expect(parseViewMode('calendar', ['list', 'board'])).toBeNull()
    expect(parseViewMode('gantt', ALL)).toBeNull()
    expect(parseViewMode('', ALL)).toBeNull()
  })

  it('prefers the URL, then the remembered mode, then the list', () => {
    expect(resolveViewMode('board', 'calendar', ALL)).toBe('board')
    expect(resolveViewMode(null, 'calendar', ALL)).toBe('calendar')
    expect(resolveViewMode(null, 'calendar', ['list', 'board'])).toBe('list')
    expect(resolveViewMode('nonsense', null, ALL)).toBe('list')
  })

  it('writes ?view= keeping the other params and remembers the choice per user and list', () => {
    const { result } = renderHook(() => ({ vm: useViewMode('defects', ['list', 'board']), loc: useLocation() }), {
      wrapper: wrapper('/defects?severity=High'),
    })
    expect(result.current.vm.mode).toBe('list')
    act(() => result.current.vm.setMode('board'))
    expect(result.current.vm.mode).toBe('board')
    expect(result.current.loc.search).toContain('severity=High')
    expect(result.current.loc.search).toContain('view=board')
    expect(localStorage.getItem(viewModeStorageKey('u1', 'defects'))).toBe('board')
    act(() => result.current.vm.setMode('list'))
    expect(result.current.loc.search).not.toContain('view=')
    expect(localStorage.getItem(viewModeStorageKey('u1', 'defects'))).toBe('list')
  })

  it('restores the remembered mode when the URL has none and survives blocked storage', () => {
    localStorage.setItem(viewModeStorageKey('u1', 'defects'), 'board')
    const { result } = renderHook(() => useViewMode('defects', ['list', 'board']), { wrapper: wrapper('/defects') })
    expect(result.current.mode).toBe('board')
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    const blocked = renderHook(() => useViewMode('defects', ['list', 'board']), { wrapper: wrapper('/defects?view=board') })
    expect(blocked.result.current.mode).toBe('board')
    spy.mockRestore()
  })

  it('switches back to the list when the URL had no view and the mode came from memory', () => {
    localStorage.setItem(viewModeStorageKey('u1', 'defects'), 'board')
    const { result } = renderHook(() => useViewMode('defects', ['list', 'board']), { wrapper: wrapper('/defects') })
    expect(result.current.mode).toBe('board')
    act(() => result.current.setMode('list'))
    expect(result.current.mode).toBe('list')
  })

  it('delegates to the page URL filters when given a source', () => {
    const set = vi.fn()
    const { result } = renderHook(() => useViewMode('defects', ['list', 'board'], { raw: 'board', set }), { wrapper: wrapper('/defects') })
    expect(result.current.mode).toBe('board')
    act(() => result.current.setMode('list'))
    expect(set).toHaveBeenCalledWith('')
  })
})
