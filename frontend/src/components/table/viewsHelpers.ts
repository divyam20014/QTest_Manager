import { useQuery } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'

import { listSavedViews, type ViewListKey } from '@/api/savedViews'

export interface ViewState {
  filters: Record<string, string>
  sort: string | null
}

/** Drops empty values so a saved view only holds filters that were actually set. */
export function compactFilters(values: Record<string, string>, keys: readonly string[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (const key of keys) {
    const v = values[key]
    if (v) out[key] = v
  }
  return out
}

export const viewsKey = (listKey: ViewListKey) => ['saved-views', listKey] as const

/** Applies the user's default view once, when the list is first opened with no filters in the URL. */
export function useApplyDefaultView(listKey: ViewListKey, hasUrlFilters: boolean, onApply: (view: ViewState) => void) {
  const initiallyFiltered = useRef(hasUrlFilters)
  const done = useRef(false)
  const query = useQuery({ queryKey: viewsKey(listKey), queryFn: () => listSavedViews(listKey), staleTime: 60_000 })
  useEffect(() => {
    if (done.current || !query.data) return
    done.current = true
    if (initiallyFiltered.current) return
    const def = query.data.find((v) => v.is_default)
    if (def) onApply({ filters: def.filters, sort: def.sort })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query.data])
}
