import { useCallback, useState } from 'react'

// Phase 2 (command palette + advanced table UX): shared per-view table
// preferences -- column visibility and resized widths. Pure per-browser
// view-state (not business data), so localStorage is the deliberate
// choice here, consistent with how "remember last tenant" from an
// earlier pass was also localStorage-based rather than a new backend
// preferences table. Keyed by `viewKey` only (not per logged-in user) --
// this is a per-device convenience, and on a shared machine the next
// user simply sees whatever the view was last left as, which is an
// acceptable tradeoff for UI chrome state.
export interface TableColumnDef {
  key: string
  label: string
  /** Core identity column -- always shown, not offered in the visibility menu. */
  alwaysVisible?: boolean
  defaultWidth?: number
}

interface StoredPrefs {
  hidden: string[]
  widths: Record<string, number>
}

function storageKey(viewKey: string): string {
  return `qtesthub:table-prefs:${viewKey}`
}

function readPrefs(viewKey: string): StoredPrefs {
  try {
    const raw = localStorage.getItem(storageKey(viewKey))
    if (!raw) return { hidden: [], widths: {} }
    const parsed = JSON.parse(raw)
    return {
      hidden: Array.isArray(parsed.hidden) ? parsed.hidden : [],
      widths: typeof parsed.widths === 'object' && parsed.widths ? parsed.widths : {},
    }
  } catch {
    return { hidden: [], widths: {} }
  }
}

function writePrefs(viewKey: string, prefs: StoredPrefs) {
  try {
    localStorage.setItem(storageKey(viewKey), JSON.stringify(prefs))
  } catch {
    // Private browsing / blocked storage -- preferences just won't persist.
  }
}

export function useColumnPrefs(viewKey: string, columns: TableColumnDef[]) {
  const [prefs, setPrefs] = useState<StoredPrefs>(() => readPrefs(viewKey))

  const persist = useCallback(
    (next: StoredPrefs) => {
      setPrefs(next)
      writePrefs(viewKey, next)
    },
    [viewKey],
  )

  const isVisible = useCallback(
    (key: string) => {
      const col = columns.find((c) => c.key === key)
      if (col?.alwaysVisible) return true
      return !prefs.hidden.includes(key)
    },
    [columns, prefs.hidden],
  )

  const toggleVisible = useCallback(
    (key: string) => {
      const hidden = prefs.hidden.includes(key)
        ? prefs.hidden.filter((k) => k !== key)
        : [...prefs.hidden, key]
      persist({ ...prefs, hidden })
    },
    [prefs, persist],
  )

  const showAll = useCallback(() => persist({ ...prefs, hidden: [] }), [prefs, persist])

  const width = useCallback(
    (key: string) => prefs.widths[key] ?? columns.find((c) => c.key === key)?.defaultWidth,
    [columns, prefs.widths],
  )

  const setWidth = useCallback(
    (key: string, value: number) => {
      persist({ ...prefs, widths: { ...prefs.widths, [key]: Math.round(value) } })
    },
    [prefs, persist],
  )

  const resetWidths = useCallback(() => persist({ ...prefs, widths: {} }), [prefs, persist])

  return { isVisible, toggleVisible, showAll, width, setWidth, resetWidths, hiddenCount: prefs.hidden.length }
}

export function useSavedFilters<T extends Record<string, string>>(viewKey: string) {
  const key = `qtesthub:table-filters:${viewKey}`
  const [saved, setSaved] = useState<Record<string, T>>(() => {
    try {
      const raw = localStorage.getItem(key)
      return raw ? JSON.parse(raw) : {}
    } catch {
      return {}
    }
  })

  const persist = useCallback(
    (next: Record<string, T>) => {
      setSaved(next)
      try {
        localStorage.setItem(key, JSON.stringify(next))
      } catch {
        // Private browsing / blocked storage.
      }
    },
    [key],
  )

  const save = useCallback((name: string, filters: T) => persist({ ...saved, [name]: filters }), [saved, persist])
  const remove = useCallback(
    (name: string) => {
      const next = { ...saved }
      delete next[name]
      persist(next)
    },
    [saved, persist],
  )

  return { saved, save, remove }
}
