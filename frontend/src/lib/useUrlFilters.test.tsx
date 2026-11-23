import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { describe, expect, it } from 'vitest'

import { useUrlFilters } from './useUrlFilters'

const defaults = { status: '', severity: '', page: '1' }

function wrapper(initial: string) {
  return ({ children }: { children: ReactNode }) => <MemoryRouter initialEntries={[initial]}>{children}</MemoryRouter>
}

function useBoth() {
  return { filters: useUrlFilters(defaults), location: useLocation() }
}

describe('useUrlFilters', () => {
  it('composes two updates made before the router re-renders', () => {
    const { result } = renderHook(useBoth, { wrapper: wrapper('/defects?status=Closed') })
    act(() => {
      result.current.filters.setFilters({ status: '' }) // the "All" tab
      result.current.filters.setFilters({ severity: 'Low' }) // a filter ticked right after
    })
    expect(result.current.location.search).toBe('?severity=Low')
  })

  it('keeps working across renders', () => {
    const { result } = renderHook(useBoth, { wrapper: wrapper('/defects') })
    act(() => result.current.filters.setFilters({ status: 'New' }))
    act(() => result.current.filters.setFilters({ severity: 'High' }))
    expect(result.current.location.search).toBe('?status=New&severity=High')
    act(() => result.current.filters.clearAll())
    expect(result.current.location.search).toBe('')
  })
})
