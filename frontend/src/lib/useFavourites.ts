import { useCallback, useMemo, useSyncExternalStore } from 'react'

import { useAuth } from '@/lib/auth'
import {
  type PinType,
  type PinnedItem,
  isPinned,
  pinStorageKey,
  readPinned,
  refreshTitle,
  removePinned,
  subscribePinned,
  toggleFavourite,
  updatePinned,
} from '@/lib/pinnedItems'

/** The signed-in user's favourites (browser storage, per tenant and user). */
export function useFavourites() {
  const { user } = useAuth()
  const key = user ? pinStorageKey('favourites', user.tenant_id, user.user_id) : null
  const items = useSyncExternalStore(
    subscribePinned,
    () => readPinned(key),
    () => readPinned(null),
  )

  const toggle = useCallback(
    (item: Omit<PinnedItem, 'at'>) => {
      if (key) updatePinned(key, (list) => toggleFavourite(list, { ...item, at: Date.now() }))
    },
    [key],
  )
  const remove = useCallback(
    (itemKey: string) => {
      if (key) updatePinned(key, (list) => removePinned(list, itemKey))
    },
    [key],
  )
  /** Keep a pinned record's name current after it was renamed. */
  const refresh = useCallback(
    (item: Omit<PinnedItem, 'at'>) => {
      if (key) updatePinned(key, (list) => refreshTitle(list, { ...item, at: Date.now() }))
    },
    [key],
  )
  const has = useCallback((type: PinType, id: string) => isPinned(items, { type, id }), [items])

  return useMemo(() => ({ items, toggle, remove, refresh, has }), [items, toggle, remove, refresh, has])
}
