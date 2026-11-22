import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'

import { tablePrefsKey, useTablePrefs, type TableColumnDef } from './tablePrefs'

const COLUMNS: TableColumnDef[] = [
  { key: 'title', label: 'Title', alwaysVisible: true },
  { key: 'owner', label: 'Owner' },
  { key: 'status', label: 'Status', alwaysVisible: true },
]

describe('useTablePrefs', () => {
  beforeEach(() => localStorage.clear())

  it('defaults to all columns visible and comfortable density', () => {
    const { result } = renderHook(() => useTablePrefs('t1', COLUMNS))
    expect(result.current.isVisible('owner')).toBe(true)
    expect(result.current.density).toBe('comfortable')
  })

  it('hides defaultHidden columns until the user saves preferences', () => {
    const cols: TableColumnDef[] = [
      { key: 'title', label: 'Title', alwaysVisible: true },
      { key: 'region', label: 'Region', defaultHidden: true },
    ]
    const first = renderHook(() => useTablePrefs('t-default', cols))
    expect(first.result.current.isVisible('region')).toBe(false)
    act(() => first.result.current.toggleVisible('region'))
    const second = renderHook(() => useTablePrefs('t-default', cols))
    expect(second.result.current.isVisible('region')).toBe(true)
  })

  it('persists hidden columns and density, and never hides key columns', () => {
    const first = renderHook(() => useTablePrefs('t1', COLUMNS))
    act(() => first.result.current.toggleVisible('owner'))
    act(() => first.result.current.toggleVisible('title'))
    act(() => first.result.current.setDensity('compact'))
    const second = renderHook(() => useTablePrefs('t1', COLUMNS))
    expect(second.result.current.isVisible('owner')).toBe(false)
    expect(second.result.current.isVisible('title')).toBe(true)
    expect(second.result.current.density).toBe('compact')
    act(() => second.result.current.showAll())
    expect(second.result.current.isVisible('owner')).toBe(true)
    expect(second.result.current.density).toBe('compact')
  })

  it('keeps tables independent and survives corrupt storage', () => {
    localStorage.setItem(tablePrefsKey('t2'), '{not json')
    const { result } = renderHook(() => useTablePrefs('t2', COLUMNS))
    expect(result.current.density).toBe('comfortable')
    const other = renderHook(() => useTablePrefs('t3', COLUMNS))
    act(() => other.result.current.setDensity('compact'))
    expect(renderHook(() => useTablePrefs('t2', COLUMNS)).result.current.density).toBe('comfortable')
  })

  it('reads the legacy user-less key (hidden columns carry over)', () => {
    localStorage.setItem(tablePrefsKey('t4'), JSON.stringify({ hidden: ['owner'], widths: {} }))
    const { result } = renderHook(() => useTablePrefs('t4', COLUMNS))
    expect(result.current.isVisible('owner')).toBe(false)
  })
})
