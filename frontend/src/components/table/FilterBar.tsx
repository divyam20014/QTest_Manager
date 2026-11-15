import { SlidersHorizontal } from 'lucide-react'
import { type ReactNode, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Dialog, DialogFooter } from '@/components/ui/dialog'
import { useIsMobile } from '@/lib/useMediaQuery'
import { cn } from '@/lib/utils'

// Mobile redesign Phase 2: list-page filters.
//
//   >= md   exactly the old inline row of controls (children, then the
//           toolbar on the right) -- nothing changes on desktop;
//   <  md   the filter controls move into a bottom sheet behind one
//           "Filters" button that shows how many are active. Filters apply
//           live as they are changed (as they always did), so the sheet needs
//           no Apply step -- just Clear and Done.
//
// The controls are rendered in exactly one place at a time, so ids/labels
// are never duplicated. Inside the sheet, any width classes the page gave a
// control (w-48, w-56, ...) are overridden to full width.

export function FilterBar({
  children,
  primary,
  saved,
  toolbar,
  activeCount,
  onClear,
  desktopClear = true,
}: {
  /** The filter controls (selects, date range, "show deprecated" ...). */
  children: ReactNode
  /** A control that stays visible on a phone beside the Filters button (usually search). */
  primary?: ReactNode
  /** Saved-filters menu: right side on desktop, top of the sheet on a phone. */
  saved?: ReactNode
  /** Desktop-only chrome (column visibility etc. -- meaningless for cards). */
  toolbar?: ReactNode
  /** Number of active filters (excluding `primary`). */
  activeCount: number
  /** Resets everything in `children`. */
  onClear: () => void
  /** Show a "Clear filters" button in the desktop row (pages that never had one can opt out). */
  desktopClear?: boolean
}) {
  const isMobile = useIsMobile()
  const [open, setOpen] = useState(false)

  if (!isMobile) {
    return (
      <div className="flex flex-wrap items-end gap-3">
        {primary}
        {children}
        {desktopClear && activeCount > 0 && (
          <Button variant="ghost" size="sm" onClick={onClear}>
            Clear filters
          </Button>
        )}
        {(saved || toolbar) && (
          <div className="ml-auto flex items-end gap-2 pb-0.5">
            {saved}
            {toolbar}
          </div>
        )}
      </div>
    )
  }

  return (
    <>
      <div className="flex items-end gap-2">
        {primary && <div className="min-w-0 flex-1">{primary}</div>}
        <Button
          type="button"
          variant="outline"
          onClick={() => setOpen(true)}
          aria-haspopup="dialog"
          className={cn('relative shrink-0 gap-2 px-3', !primary && 'w-full')}
        >
          <SlidersHorizontal className="size-4" aria-hidden="true" />
          Filters
          {activeCount > 0 && (
            <span
              aria-label={`${activeCount} active`}
              className="inline-flex min-w-5 items-center justify-center rounded-full bg-[var(--primary)] px-1.5 text-xs font-semibold text-[var(--primary-foreground)]"
            >
              {activeCount}
            </span>
          )}
        </Button>
      </div>

      <Dialog open={open} onClose={() => setOpen(false)} title="Filters">
        <div className="flex flex-col gap-4 [&_input:not([type=checkbox]):not([type=radio])]:w-full [&_select]:w-full">
          {saved && (
            <div className="flex [&_[role=menu]]:left-0 [&_[role=menu]]:right-auto [&_[role=menu]]:max-w-[calc(100vw-4rem)]">
              {saved}
            </div>
          )}
          {children}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={activeCount === 0}
              onClick={() => {
                onClear()
              }}
            >
              Clear filters
            </Button>
            <Button type="button" onClick={() => setOpen(false)}>
              Done
            </Button>
          </DialogFooter>
        </div>
      </Dialog>
    </>
  )
}

/** Wraps an unlabeled desktop filter control (one that relies on `aria-label`)
 * with a visible caption -- but only inside the phone sheet, where there is
 * room for it and a bare "All Statuses" select would be ambiguous. Desktop
 * renders the control untouched. */
export function FilterField({ label, children }: { label: string; children: ReactNode }) {
  const isMobile = useIsMobile()
  if (!isMobile) return <>{children}</>
  return (
    <div className="flex flex-col gap-1.5">
      <span aria-hidden="true" className="text-xs text-[var(--muted-foreground)]">
        {label}
      </span>
      {children}
    </div>
  )
}
