import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { SavedView } from '@/api/savedViews'

import { useApplyDefaultView } from './viewsHelpers'

const listSavedViews = vi.fn()
vi.mock('@/api/savedViews', () => ({ listSavedViews: (...a: unknown[]) => listSavedViews(...a) }))

const DEFAULT_VIEW = {
  id: 'v1',
  name: 'Mine',
  is_default: true,
  filters: { severity: 'critical' },
  sort: '-created_at',
  columns: ['title'],
} as unknown as SavedView

function setup(initialFiltered: boolean) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  const onApply = vi.fn()
  const hook = renderHook(({ filtered }) => useApplyDefaultView('defects', filtered, onApply), {
    wrapper,
    initialProps: { filtered: initialFiltered },
  })
  return { onApply, hook }
}

describe('useApplyDefaultView', () => {
  beforeEach(() => listSavedViews.mockReset())

  it('applies the default view once when the list opens with nothing set', async () => {
    listSavedViews.mockResolvedValue([DEFAULT_VIEW])
    const { onApply, hook } = setup(false)
    await waitFor(() => expect(onApply).toHaveBeenCalledTimes(1))
    expect(onApply).toHaveBeenCalledWith({ filters: DEFAULT_VIEW.filters, sort: '-created_at', columns: ['title'] })
    hook.rerender({ filtered: false })
    expect(onApply).toHaveBeenCalledTimes(1)
  })

  it('does not overwrite filters already in the URL', async () => {
    listSavedViews.mockResolvedValue([DEFAULT_VIEW])
    const { onApply } = setup(true)
    await waitFor(() => expect(listSavedViews).toHaveBeenCalled())
    await new Promise((r) => setTimeout(r, 30))
    expect(onApply).not.toHaveBeenCalled()
  })

  it('does not overwrite a filter the user sets while the saved views are still loading', async () => {
    let resolve!: (v: SavedView[]) => void
    listSavedViews.mockReturnValue(new Promise<SavedView[]>((r) => (resolve = r)))
    const { onApply, hook } = setup(false)
    hook.rerender({ filtered: true }) // the user picked a filter before the views arrived
    resolve([DEFAULT_VIEW])
    await waitFor(() => expect(listSavedViews).toHaveBeenCalled())
    await new Promise((r) => setTimeout(r, 30))
    expect(onApply).not.toHaveBeenCalled()
  })

  it('does nothing when no view is marked default', async () => {
    listSavedViews.mockResolvedValue([{ ...DEFAULT_VIEW, is_default: false }])
    const { onApply } = setup(false)
    await waitFor(() => expect(listSavedViews).toHaveBeenCalled())
    await new Promise((r) => setTimeout(r, 30))
    expect(onApply).not.toHaveBeenCalled()
  })
})
