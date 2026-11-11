import type { ReactNode } from 'react'
import { useEffect, useRef } from 'react'
import { X } from 'lucide-react'

import { cn } from '@/lib/utils'

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'

// Shared focus-trap/Escape/return-focus behavior for both Dialog (centered
// modal) and Drawer (side panel) -- UI/UX review bug #2's fix, factored out
// so the two surfaces never drift out of sync with each other.
function useOverlayBehavior(
  open: boolean,
  onClose: () => void,
  panelRef: React.RefObject<HTMLDivElement | null>,
  closeButtonRef: React.RefObject<HTMLButtonElement | null>,
) {
  const triggerElementRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!open) return

    triggerElementRef.current = document.activeElement as HTMLElement | null
    const focusTimer = window.setTimeout(() => closeButtonRef.current?.focus(), 0)

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onClose()
        return
      }
      if (event.key !== 'Tab') return

      const panel = panelRef.current
      if (!panel) return
      const focusable = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
        (el) => el.offsetParent !== null,
      )
      if (focusable.length === 0) return

      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      const active = document.activeElement

      if (event.shiftKey && active === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && active === last) {
        event.preventDefault()
        first.focus()
      } else if (!panel.contains(active)) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', handleKeyDown, true)
    return () => {
      window.clearTimeout(focusTimer)
      document.removeEventListener('keydown', handleKeyDown, true)
      triggerElementRef.current?.focus?.()
    }
  }, [open, onClose, panelRef, closeButtonRef])
}

export function Dialog({
  open,
  onClose,
  title,
  children,
  className,
}: {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
  className?: string
}) {
  const panelRef = useRef<HTMLDivElement>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  useOverlayBehavior(open, onClose, panelRef, closeButtonRef)

  if (!open) return null

  return (
    <div
      className="qth-animate-in fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-[1px]"
      style={{ animation: 'qth-fade-in 0.15s ease-out' }}
      onClick={onClose}
      role="presentation"
    >
      <div
        ref={panelRef}
        className={cn(
          // Pass 2: a dialog's content can grow taller than the viewport
          // (e.g. the Test Case form after its schema-realignment fields) --
          // without a capped height + internal scroll, the bottom (often
          // the only submit button) ends up permanently unreachable, for a
          // real user on a short screen as much as for Playwright. Found
          // via a real E2E failure during this pass, not anticipated
          // up front.
          'qth-animate-in relative flex max-h-[90vh] w-full max-w-lg flex-col rounded-xl border border-[var(--border)] bg-[var(--background)] shadow-xl',
          className,
        )}
        style={{ animation: 'qth-scale-in 0.16s ease-out' }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <button
          ref={closeButtonRef}
          type="button"
          onClick={onClose}
          aria-label="Close dialog"
          className="absolute right-4 top-4 rounded-md p-1 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--muted)] hover:text-[var(--foreground)]"
        >
          <X className="size-4" />
        </button>
        <h2 className="shrink-0 border-b border-[var(--border)] px-5 py-4 pr-10 text-sm font-semibold">{title}</h2>
        <div className="overflow-y-auto px-5 py-5">{children}</div>
      </div>
    </div>
  )
}

// GAP-91 item 1: a side drawer for forms too large/cramped for the
// centered Dialog (10+ fields) -- same focus-trap/Escape/backdrop
// behavior, but a full-height panel from the right with real room to
// breathe instead of a capped `max-w-lg` box.
export function Drawer({
  open,
  onClose,
  title,
  children,
  className,
}: {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
  className?: string
}) {
  const panelRef = useRef<HTMLDivElement>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  useOverlayBehavior(open, onClose, panelRef, closeButtonRef)

  if (!open) return null

  return (
    <div
      className="qth-animate-in fixed inset-0 z-50 flex justify-end bg-black/40 backdrop-blur-[1px]"
      style={{ animation: 'qth-fade-in 0.15s ease-out' }}
      onClick={onClose}
      role="presentation"
    >
      <div
        ref={panelRef}
        className={cn(
          'qth-animate-in flex h-full w-full max-w-2xl flex-col border-l border-[var(--border)] bg-[var(--background)] shadow-xl',
          className,
        )}
        style={{ animation: 'qth-drawer-in 0.2s ease-out' }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-[var(--border)] px-6 py-4">
          <h2 className="text-sm font-semibold">{title}</h2>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            aria-label="Close panel"
            className="rounded-md p-1.5 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--muted)] hover:text-[var(--foreground)]"
          >
            <X className="size-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-5">{children}</div>
      </div>
    </div>
  )
}
