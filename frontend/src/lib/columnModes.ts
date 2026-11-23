// Column modes shared by the field-standard lists (Test Cases ADR-117, Defects ADR-119):
//   default  the default columns the server's catalogue names
//   all      every field of the standard
//   custom   whatever the user ticked (and what a saved view stores)
// The server's field catalogue is the source of truth for keys and labels; each list adds its own
// UI-only optional columns ("extras") and picks its own storage key and fallback defaults.
import { useCallback, useState } from 'react'

import { useCurrentUserId } from '@/lib/auth'

export type ColumnMode = 'default' | 'all' | 'custom'

export interface ColumnPrefs {
  mode: ColumnMode
  /** Only meaningful in custom mode. */
  custom: string[]
}

/** What the picker needs of one column. */
export interface ColumnSpecLike {
  key: string
  label: string
}

/** The part of a field catalogue the column logic reads. */
export interface ColumnCatalogLike<S extends ColumnSpecLike> {
  fields: S[]
  default_columns: string[]
}

export interface ColumnConfig<S extends ColumnSpecLike> {
  /** Optional columns outside the standard's fields. */
  extras: S[]
  /** Used when the catalogue has not loaded: the default columns, in order. */
  fallbackDefaults: string[]
  /** localStorage key prefix; the user id is appended. */
  storagePrefix: string
}

export const DEFAULT_PREFS: ColumnPrefs = { mode: 'default', custom: [] }

function sameSet(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((k) => b.includes(k))
}

export function createColumnModel<S extends ColumnSpecLike>(config: ColumnConfig<S>) {
  type Catalog = ColumnCatalogLike<S> | undefined

  const allFieldKeys = (catalog: Catalog): string[] => (catalog ? catalog.fields.map((f) => f.key) : config.fallbackDefaults)

  const defaultKeys = (catalog: Catalog): string[] =>
    catalog && catalog.default_columns.length > 0 ? catalog.default_columns : config.fallbackDefaults

  /** Every column the picker offers: the standard's fields, then the optional extras. */
  const pickerColumns = (catalog: Catalog): S[] => [...(catalog?.fields ?? []), ...config.extras]

  const knownKeys = (catalog: Catalog): string[] => pickerColumns(catalog).map((c) => c.key)

  /** The ordered column keys to show for the given preferences. Never empty. */
  function resolveColumns(catalog: Catalog, prefs: ColumnPrefs): string[] {
    if (prefs.mode === 'all') return allFieldKeys(catalog)
    if (prefs.mode === 'custom') {
      const order = knownKeys(catalog)
      const wanted = new Set(prefs.custom)
      const keys = order.filter((k) => wanted.has(k))
      if (keys.length > 0) return keys
    }
    return defaultKeys(catalog)
  }

  /** The mode that describes an explicit list of keys (a saved view's columns). */
  function modeForKeys(catalog: Catalog, keys: string[]): ColumnMode {
    if (sameSet(keys, defaultKeys(catalog))) return 'default'
    if (sameSet(keys, allFieldKeys(catalog))) return 'all'
    return 'custom'
  }

  /** Preferences that show exactly `keys` (unknown keys are dropped; nothing left means default). */
  function prefsForKeys(catalog: Catalog, keys: string[]): ColumnPrefs {
    const known = new Set(knownKeys(catalog))
    const clean = keys.filter((k) => known.has(k))
    if (clean.length === 0) return { ...DEFAULT_PREFS }
    const mode = modeForKeys(catalog, clean)
    return { mode, custom: mode === 'custom' ? clean : [] }
  }

  /** Ticks / unticks one column. Any change from default or all becomes custom, starting from what is shown. */
  function toggleColumn(catalog: Catalog, prefs: ColumnPrefs, key: string): ColumnPrefs {
    const shown = resolveColumns(catalog, prefs)
    const next = shown.includes(key) ? shown.filter((k) => k !== key) : [...shown, key]
    // The last column cannot be removed: a table needs at least one.
    if (next.length === 0) return prefs
    return { mode: 'custom', custom: next }
  }

  /** Switching to custom keeps what is currently shown as the starting selection. */
  function setMode(catalog: Catalog, prefs: ColumnPrefs, mode: ColumnMode): ColumnPrefs {
    if (mode === 'custom') return { mode, custom: prefs.mode === 'custom' ? prefs.custom : resolveColumns(catalog, prefs) }
    return { mode, custom: prefs.custom }
  }

  function readColumnPrefs(userId: string | null): ColumnPrefs {
    try {
      const raw = localStorage.getItem(`${config.storagePrefix}:${userId ?? 'anon'}`)
      if (!raw) return { ...DEFAULT_PREFS }
      const parsed = JSON.parse(raw) as Partial<ColumnPrefs>
      const mode: ColumnMode = parsed.mode === 'all' || parsed.mode === 'custom' ? parsed.mode : 'default'
      const custom = Array.isArray(parsed.custom) ? parsed.custom.filter((k): k is string => typeof k === 'string') : []
      return { mode, custom }
    } catch {
      return { ...DEFAULT_PREFS }
    }
  }

  function writeColumnPrefs(userId: string | null, prefs: ColumnPrefs) {
    try {
      localStorage.setItem(`${config.storagePrefix}:${userId ?? 'anon'}`, JSON.stringify(prefs))
    } catch {
      // Storage blocked: the choice just does not persist (saved views still do).
    }
  }

  /** Column choice for the list: remembered per user in this browser (fallback), overridden by a saved view. */
  function useColumns(catalog: Catalog) {
    const userId = useCurrentUserId()
    const [prefs, setPrefsState] = useState<ColumnPrefs>(() => readColumnPrefs(userId))
    const setPrefs = useCallback(
      (next: ColumnPrefs) => {
        setPrefsState(next)
        writeColumnPrefs(userId, next)
      },
      [userId],
    )
    const keys = resolveColumns(catalog, prefs)
    return {
      prefs,
      keys,
      mode: prefs.mode,
      setMode: (mode: ColumnMode) => setPrefs(setMode(catalog, prefs, mode)),
      toggle: (key: string) => setPrefs(toggleColumn(catalog, prefs, key)),
      /** Show exactly these keys (applying a saved view). */
      applyKeys: (list: string[] | null | undefined) =>
        setPrefs(list && list.length ? prefsForKeys(catalog, list) : { ...DEFAULT_PREFS }),
      reset: () => setPrefs({ ...DEFAULT_PREFS }),
    }
  }

  return {
    allFieldKeys,
    defaultKeys,
    pickerColumns,
    resolveColumns,
    modeForKeys,
    prefsForKeys,
    toggleColumn,
    setMode,
    readColumnPrefs,
    useColumns,
  }
}
