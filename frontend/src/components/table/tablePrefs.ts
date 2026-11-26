import { useCallback, useState } from 'react'

import { useCurrentUserId } from '@/lib/auth'

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
  /** Hidden until the user turns it on (keeps wide tables inside 1280px); ignored once prefs are saved. */
  defaultHidden?: boolean
}

// ADR-105: row density, shared by every data table. Phones render cards and
// ignore it (tap targets stay >= 44px).
export type TableDensity = 'comfortable' | 'compact'

interface StoredPrefs {
  hidden: string[]
  widths: Record<string, number>
  density: TableDensity
}

const EMPTY_PREFS: StoredPrefs = { hidden: [], widths: {}, density: 'comfortable' }

// Per user per table; the user-less key is the pre-ADR-105 one, read as a fallback.
export function tablePrefsKey(viewKey: string, userId?: string | null): string {
  return userId ? `qtesthub:table-prefs:${viewKey}:u:${userId}` : `qtesthub:table-prefs:${viewKey}`
}

export function readPrefs(viewKey: string, userId?: string | null): StoredPrefs {
  try {
    const raw = localStorage.getItem(tablePrefsKey(viewKey, userId)) ?? localStorage.getItem(tablePrefsKey(viewKey))
    if (!raw) return { ...EMPTY_PREFS }
    const parsed = JSON.parse(raw)
    return {
      hidden: Array.isArray(parsed.hidden) ? parsed.hidden : [],
      widths: typeof parsed.widths === 'object' && parsed.widths ? parsed.widths : {},
      density: parsed.density === 'compact' ? 'compact' : 'comfortable',
    }
  } catch {
    return { ...EMPTY_PREFS }
  }
}

function writePrefs(viewKey: string, userId: string | null, prefs: StoredPrefs) {
  try {
    localStorage.setItem(tablePrefsKey(viewKey, userId), JSON.stringify(prefs))
  } catch {
    // Private browsing / blocked storage -- preferences just won't persist.
  }
}

function hasStoredPrefs(viewKey: string, userId?: string | null): boolean {
  try {
    return (
      localStorage.getItem(tablePrefsKey(viewKey, userId)) !== null ||
      localStorage.getItem(tablePrefsKey(viewKey)) !== null
    )
  } catch {
    return false
  }
}

export function useColumnPrefs(viewKey: string, columns: TableColumnDef[]) {
  const userId = useCurrentUserId()
  const [prefs, setPrefs] = useState<StoredPrefs>(() => {
    const stored = readPrefs(viewKey, userId)
    if (hasStoredPrefs(viewKey, userId)) return stored
    return { ...stored, hidden: columns.filter((c) => c.defaultHidden && !c.alwaysVisible).map((c) => c.key) }
  })

  const persist = useCallback(
    (next: StoredPrefs) => {
      setPrefs(next)
      writePrefs(viewKey, userId, next)
    },
    [viewKey, userId],
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
      const hidden = prefs.hidden.includes(key) ? prefs.hidden.filter((k) => k !== key) : [...prefs.hidden, key]
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

  const setDensity = useCallback((density: TableDensity) => persist({ ...prefs, density }), [prefs, persist])

  return {
    isVisible,
    toggleVisible,
    showAll,
    width,
    setWidth,
    resetWidths,
    hiddenCount: prefs.hidden.length,
    density: prefs.density,
    setDensity,
  }
}

/** ADR-105: the single shared table-preferences hook (visible columns, widths, density). */
export const useTablePrefs = useColumnPrefs
