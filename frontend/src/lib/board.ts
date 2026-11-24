// ADR-124: the data side of a board. One paged query per column (the server filters by the column's
// status and returns that column's total), so a board never loads a whole table: each column shows
// its first page and "Load more" fetches the next one. Moving a card does not edit this cache; the
// page calls the real endpoint and invalidates, so what a column shows is always what the server holds.
import { keepPreviousData, useQueries, type QueryKey } from '@tanstack/react-query'
import { useCallback, useMemo, useState } from 'react'

export interface BoardColumnSpec {
  id: string
  label: string
  /** One line under the label (what the column holds, or why it cannot take drops). */
  hint?: string
}

export interface BoardPage<T> {
  items: T[]
  total: number
}

export interface BoardColumnState<T> {
  items: T[]
  /** The server's total for this column (undefined until the first page arrives). */
  total: number | undefined
  loading: boolean
  error: unknown
  hasMore: boolean
  loadingMore: boolean
  loadMore: () => void
  retry: () => void
}

const NO_PAGES: Record<string, number> = {}

export function useBoardColumns<T extends { id: string }>({
  rootKey,
  scope,
  columns,
  pageSize,
  fetchPage,
  enabled = true,
}: {
  /**
   * Prefix of every query key of this board. Start it with the record's own key root
   * (`['defects', 'board']`) so the invalidations the existing dialogs already make refresh the columns.
   */
  rootKey: readonly unknown[]
  /** Everything the columns share besides the column itself (filters, project). Part of the cache key. */
  scope: unknown
  columns: readonly BoardColumnSpec[]
  pageSize: number
  fetchPage: (columnId: string, page: number, pageSize: number) => Promise<BoardPage<T>>
  enabled?: boolean
}): Record<string, BoardColumnState<T>> {
  const scopeKey = JSON.stringify(scope)
  // How many pages each column has loaded; a changed scope starts over (same pattern as the list pages' paging).
  const [loaded, setLoaded] = useState<{ key: string; pages: Record<string, number> }>({ key: scopeKey, pages: {} })
  const pages = loaded.key === scopeKey ? loaded.pages : NO_PAGES

  const requests = useMemo(
    () => columns.flatMap((c) => Array.from({ length: pages[c.id] ?? 1 }, (_, i) => ({ column: c.id, page: i + 1 }))),
    [columns, pages],
  )
  const results = useQueries({
    queries: requests.map((r) => ({
      queryKey: [...rootKey, scope, r.column, r.page, pageSize] as QueryKey,
      queryFn: () => fetchPage(r.column, r.page, pageSize),
      enabled,
      placeholderData: keepPreviousData,
    })),
  })

  const loadMore = useCallback(
    (columnId: string) =>
      setLoaded((prev) => {
        const current = prev.key === scopeKey ? prev.pages : {}
        return { key: scopeKey, pages: { ...current, [columnId]: (current[columnId] ?? 1) + 1 } }
      }),
    [scopeKey],
  )

  const out: Record<string, BoardColumnState<T>> = {}
  for (const c of columns) {
    const mine = requests.map((r, i) => ({ r, q: results[i] })).filter(({ r }) => r.column === c.id)
    const seen = new Set<string>()
    const items: T[] = []
    for (const { q } of mine) {
      for (const item of q.data?.items ?? []) {
        if (!seen.has(item.id)) {
          seen.add(item.id)
          items.push(item)
        }
      }
    }
    const first = mine[0]?.q
    const last = mine[mine.length - 1]?.q
    const total = first?.data?.total
    out[c.id] = {
      items,
      total,
      loading: !first || (first.isLoading && !first.data),
      error: mine.find(({ q }) => q.isError)?.q.error ?? null,
      hasMore: total !== undefined && items.length < total && !mine.some(({ q }) => q.isError),
      loadingMore: !!last && mine.length > 1 && last.isFetching && !last.data,
      loadMore: () => loadMore(c.id),
      retry: () => mine.forEach(({ q }) => void q.refetch()),
    }
  }
  return out
}
