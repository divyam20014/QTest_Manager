// ADR-124: the view of a list (List / Board / Calendar). The URL (`?view=`) is authoritative so a
// view is shareable and survives a refresh; the choice is also remembered per user and per list
// in localStorage (a per-viewer convenience: every storage call is wrapped, private windows throw).
// A saved view carries the mode as the `view` filter key.
import { useCallback, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'

import { useAuth } from '@/lib/auth'

export type ViewMode = 'list' | 'board' | 'calendar'

export const VIEW_MODES: ViewMode[] = ['list', 'board', 'calendar']

export const VIEW_MODE_LABEL: Record<ViewMode, string> = { list: 'List', board: 'Board', calendar: 'Calendar' }

/** The mode named by a URL / saved-view value, or null when it is empty, unknown or not offered here. */
export function parseViewMode(raw: string | null | undefined, allowed: readonly ViewMode[]): ViewMode | null {
  return raw && (allowed as readonly string[]).includes(raw) ? (raw as ViewMode) : null
}

export function viewModeStorageKey(userId: string | null | undefined, listKey: string): string {
  return `qth:view-mode:${userId ?? 'anon'}:${listKey}`
}

function readStored(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function writeStored(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    /* private mode: the URL still carries the choice */
  }
}

/** URL value, else the remembered one, else List. */
export function resolveViewMode(raw: string | null | undefined, stored: string | null, allowed: readonly ViewMode[]): ViewMode {
  return parseViewMode(raw, allowed) ?? parseViewMode(stored, allowed) ?? 'list'
}

/**
 * The view mode of one list. Pass `source` when the page already owns the URL through `useUrlFilters`
 * (its `view` key); without it the hook reads and writes `?view=` itself and leaves every other
 * param alone. List is the default and is never written to the URL: choosing it is remembered instead.
 */
export function useViewMode(
  listKey: string,
  allowed: readonly ViewMode[],
  source?: { raw: string; set: (value: string) => void },
): { mode: ViewMode; setMode: (mode: ViewMode) => void } {
  const { user } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()
  const storageKey = viewModeStorageKey(user?.user_id, listKey)
  const raw = source ? source.raw : searchParams.get('view')
  // The remembered mode is state, so choosing List while the URL already has no `view` still re-renders.
  const [remembered, setRemembered] = useState<{ key: string; value: string | null }>(() => ({ key: storageKey, value: readStored(storageKey) }))
  const stored = remembered.key === storageKey ? remembered.value : readStored(storageKey)
  const mode = useMemo(() => resolveViewMode(raw, stored, allowed), [raw, stored, allowed])
  const sourceSet = source?.set
  const setMode = useCallback(
    (next: ViewMode) => {
      writeStored(storageKey, next)
      setRemembered({ key: storageKey, value: next })
      const value = next === 'list' ? '' : next
      if (sourceSet) {
        sourceSet(value)
        return
      }
      setSearchParams(
        (prev) => {
          const params = new URLSearchParams(prev)
          if (value) params.set('view', value)
          else params.delete('view')
          return params
        },
        { replace: true },
      )
    },
    [storageKey, sourceSet, setSearchParams],
  )
  return { mode, setMode }
}
