import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react'

import { useAuth } from '@/lib/auth'
import {
  type PinnedItem,
  RECENT_CAP,
  pinStorageKey,
  pushRecent,
  readPinned,
  removePinned,
  subscribePinned,
  updatePinned,
} from '@/lib/pinnedItems'

/** The signed-in user's recently visited records (newest first, at most 8). */
export function useRecents() {
  const { user } = useAuth()
  const key = user ? pinStorageKey('recents', user.tenant_id, user.user_id) : null
  const items = useSyncExternalStore(
    subscribePinned,
    () => readPinned(key),
    () => readPinned(null),
  )
  const record = useCallback(
    (item: Omit<PinnedItem, 'at'>) => {
      if (key) updatePinned(key, (list) => pushRecent(list, { ...item, at: Date.now() }, RECENT_CAP))
    },
    [key],
  )
  const remove = useCallback(
    (itemKey: string) => {
      if (key) updatePinned(key, (list) => removePinned(list, itemKey))
    },
    [key],
  )
  const clear = useCallback(() => {
    if (key) updatePinned(key, (list) => (list.length === 0 ? (list as PinnedItem[]) : []))
  }, [key])
  return useMemo(() => ({ items, record, remove, clear }), [items, record, remove, clear])
}

/**
 * Record a visit to a detail page once its title is known. Pass `null` while the record
 * is loading. Depends on the primitive fields so a re-render does not re-record.
 */
export function useTrackRecent(item: Omit<PinnedItem, 'at'> | null): void {
  const { record } = useRecents()
  const type = item?.type
  const id = item?.id
  const title = item?.title
  const url = item?.url
  useEffect(() => {
    if (type && id && title && url) record({ type, id, title, url })
  }, [record, type, id, title, url])
}
