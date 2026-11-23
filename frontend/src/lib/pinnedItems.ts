/**
 * Favourites and recently visited records (ADR-121).
 *
 * Both are per-viewer conveniences kept in the browser, keyed by tenant and user so
 * two people (or two workspaces) on one machine never see each other's items. They
 * are never a source of truth: a record can be deleted or lose access after it was
 * pinned, so the sidebar lets the user remove a stale entry, and every storage call
 * is wrapped because private windows and blocked storage throw.
 *
 * This file is the pure part (parsing, list updates, keys) plus a tiny external store
 * the two hooks share, so a star toggled on a page updates the sidebar at once.
 */

export type PinType = 'project' | 'test_case' | 'defect' | 'test_run' | 'requirement'

export interface PinnedItem {
  type: PinType
  id: string
  title: string
  /** App-relative path (`/defects/…`), never an absolute or external URL. */
  url: string
  /** Epoch milliseconds when it was pinned or last visited. */
  at: number
}

export const RECENT_CAP = 8
export const FAVOURITES_CAP = 30

export const PIN_TYPE_LABEL: Record<PinType, string> = {
  project: 'Project',
  test_case: 'Test case',
  defect: 'Defect',
  test_run: 'Test run',
  requirement: 'Requirement',
}

const PIN_TYPES = new Set<string>(Object.keys(PIN_TYPE_LABEL))

export function pinKey(item: { type: PinType; id: string }): string {
  return `${item.type}:${item.id}`
}

export function pinStorageKey(kind: 'favourites' | 'recents', tenantId: string, userId: string): string {
  return `qtesthub:${kind}:${tenantId}:${userId}`
}

function isPinnedItem(value: unknown): value is PinnedItem {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return (
    typeof v.type === 'string' &&
    PIN_TYPES.has(v.type) &&
    typeof v.id === 'string' &&
    v.id.length > 0 &&
    typeof v.title === 'string' &&
    typeof v.url === 'string' &&
    // Same-app paths only: a tampered entry must never become an off-site link.
    v.url.startsWith('/') &&
    !v.url.startsWith('//') &&
    typeof v.at === 'number'
  )
}

/** Parse a stored list; anything malformed reads as an empty list (or drops the bad entry). */
export function parsePinned(raw: string | null): PinnedItem[] {
  if (!raw) return []
  try {
    const data: unknown = JSON.parse(raw)
    if (!Array.isArray(data)) return []
    return data.filter(isPinnedItem)
  } catch {
    return []
  }
}

export function isPinned(list: readonly PinnedItem[], item: { type: PinType; id: string }): boolean {
  const key = pinKey(item)
  return list.some((i) => pinKey(i) === key)
}

/** Add the item (newest first) or remove it when already there. */
export function toggleFavourite(list: readonly PinnedItem[], item: PinnedItem): PinnedItem[] {
  if (isPinned(list, item)) return removePinned(list, pinKey(item))
  return [item, ...list].slice(0, FAVOURITES_CAP)
}

export function removePinned(list: readonly PinnedItem[], key: string): PinnedItem[] {
  return list.filter((i) => pinKey(i) !== key)
}

/**
 * Record a visit: the item moves to the front (no duplicates), the list keeps the
 * newest `cap`. Returns the same array when the front item is already identical, so a
 * re-render of the same page does not rewrite storage.
 */
export function pushRecent(list: readonly PinnedItem[], item: PinnedItem, cap = RECENT_CAP): PinnedItem[] {
  const head = list[0]
  if (head && pinKey(head) === pinKey(item) && head.title === item.title && head.url === item.url) {
    return list as PinnedItem[]
  }
  return [item, ...removePinned(list, pinKey(item))].slice(0, cap)
}

/** A refreshed title/url for a pinned record, so a renamed record does not show its old name. */
export function refreshTitle(list: readonly PinnedItem[], item: PinnedItem): PinnedItem[] {
  const key = pinKey(item)
  let changed = false
  const next = list.map((i) => {
    if (pinKey(i) !== key || (i.title === item.title && i.url === item.url)) return i
    changed = true
    return { ...i, title: item.title, url: item.url }
  })
  return changed ? next : (list as PinnedItem[])
}

// ---- external store ---------------------------------------------------------

const listeners = new Set<() => void>()
// Used when localStorage is unavailable, so the lists still work for this page view.
const memory = new Map<string, string>()
const snapshots = new Map<string, { raw: string | null; list: PinnedItem[] }>()
const EMPTY: PinnedItem[] = []

function readRaw(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return memory.get(key) ?? null
  }
}

function writeRaw(key: string, value: string): void {
  memory.set(key, value)
  try {
    localStorage.setItem(key, value)
  } catch {
    // Blocked storage: the in-memory copy above keeps this page view consistent.
  }
}

/** Stable-reference snapshot for useSyncExternalStore (same array until the stored text changes). */
export function readPinned(key: string | null): PinnedItem[] {
  if (!key) return EMPTY
  const raw = readRaw(key)
  const cached = snapshots.get(key)
  if (cached && cached.raw === raw) return cached.list
  const list = parsePinned(raw)
  snapshots.set(key, { raw, list })
  return list
}

export function updatePinned(key: string, update: (list: readonly PinnedItem[]) => PinnedItem[]): void {
  const current = readPinned(key)
  const next = update(current)
  if (next === current) return
  writeRaw(key, JSON.stringify(next))
  listeners.forEach((l) => l())
}

export function subscribePinned(callback: () => void): () => void {
  listeners.add(callback)
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key.startsWith('qtesthub:favourites:') || event.key.startsWith('qtesthub:recents:')) {
      callback()
    }
  }
  window.addEventListener('storage', onStorage)
  return () => {
    listeners.delete(callback)
    window.removeEventListener('storage', onStorage)
  }
}

/** Test helper: forget cached snapshots and the in-memory fallback. */
export function resetPinnedStoreForTests(): void {
  snapshots.clear()
  memory.clear()
}
