import { Star } from 'lucide-react'
import { useEffect } from 'react'

import { IconButton } from '@/components/ui/icon-button'
import type { PinType } from '@/lib/pinnedItems'
import { useFavourites } from '@/lib/useFavourites'
import { useTrackRecent } from '@/lib/useRecents'
import { cn } from '@/lib/utils'

/**
 * Put in a detail page's header `meta` (ADR-121). It does two things for the record shown:
 * it records the visit in Recent (once the title is known), and it renders the star that
 * adds or removes the record from Favourites. Both live in this browser, per user.
 */
export function RecordPin({ type, id, title, url }: { type: PinType; id: string; title: string; url: string }) {
  const favourites = useFavourites()
  const pinned = favourites.has(type, id)
  useTrackRecent({ type, id, title, url })

  // A renamed record keeps its current name in Favourites.
  const { refresh } = favourites
  useEffect(() => {
    if (pinned) refresh({ type, id, title, url })
  }, [pinned, refresh, type, id, title, url])

  return (
    <IconButton
      aria-label={pinned ? 'Remove from favourites' : 'Add to favourites'}
      aria-pressed={pinned}
      size="sm"
      onClick={() => favourites.toggle({ type, id, title, url })}
      data-testid="favourite-toggle"
    >
      <Star aria-hidden="true" className={cn(pinned && 'fill-[var(--status-warning)] text-[var(--status-warning)]')} />
    </IconButton>
  )
}
