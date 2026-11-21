import type { ReactNode } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { DirtyContext } from '@/components/ui/dirtyForm'
import { useOverlayBehavior } from '@/components/ui/useOverlayBehavior'
import { useIsMobile } from '@/lib/useMediaQuery'
import { cn } from '@/lib/utils'

// Mobile redesign Phase 2: below `md` a Dialog is a bottom sheet (full width,
// rounded top, safe-area aware, body scrolls under a pinned header). Above
// `md` it is the same centered raised panel as before. Same component, same
// focus trap / Escape / aria -- only layout and entry animation differ.

// Lock page scroll behind a phone-sized sheet so a swipe inside it can't
// scroll the page underneath.
function useScrollLock(active: boolean) {
  useEffect(() => {
    if (!active) return
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previous
    }
  }, [active])
}

function useDirtyGuard(onClose: () => void) {
  const dirtyRef = useRef(false)
  const returnFocusRef = useRef<HTMLElement | null>(null)
  const [confirming, setConfirming] = useState(false)
  const setDirty = useCallback((dirty: boolean) => {
    dirtyRef.current = dirty
  }, [])
  const requestClose = useCallback(() => {
    if (confirming) {
      setConfirming(false)
      return
    }
    if (dirtyRef.current) {
      returnFocusRef.current = document.activeElement as HTMLElement | null
      setConfirming(true)
    } else onClose()
  }, [confirming, onClose])
  const discard = useCallback(() => {
    setConfirming(false)
    dirtyRef.current = false
    onClose()
  }, [onClose])
  // Keep editing: hand focus back to where the user was (the prompt unmounts,
  // which would otherwise drop focus to <body>).
  const keepEditing = useCallback(() => {
    setConfirming(false)
    const target = returnFocusRef.current
    window.setTimeout(() => target?.focus?.(), 0)
  }, [])
  return { setDirty, confirming, requestClose, keepEditing, discard }
}

function DiscardPrompt({ onKeep, onDiscard }: { onKeep: () => void; onDiscard: () => void }) {
  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="qth-discard-title"
      className="absolute inset-0 z-30 flex items-center justify-center rounded-[inherit] bg-[var(--overlay-backdrop)] p-4"
    >
      <div className="qth-raised-md flex w-full max-w-sm flex-col gap-3 rounded-xl border border-[var(--border)] bg-[var(--tactile-surface-raised)] p-4">
        <h3 id="qth-discard-title" className="text-sm font-semibold">
          Discard unsaved changes?
        </h3>
        <p className="text-sm text-[var(--muted-foreground)]">
          Your edits have not been saved and will be lost.
        </p>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" autoFocus onClick={onKeep}>
            Keep editing
          </Button>
          <Button type="button" variant="destructive" onClick={onDiscard}>
            Discard
          </Button>
        </div>
      </div>
    </div>
  )
}

/** Action row for a Dialog. Plain right-aligned buttons on desktop; pinned to
 * the bottom of the sheet (above the home bar) on phones so the primary action
 * never scrolls out of reach. */
export function DialogFooter({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        // Sticky on every size so the primary action never scrolls away; padding
        // mirrors the body (24px desktop, 16px phone); actions are 44px tall.
        'sticky -bottom-5 z-10 -mx-6 -mb-5 mt-5 flex justify-end gap-2 border-t border-[var(--border)] bg-[var(--tactile-surface-raised)] px-6 py-4 [&>button]:min-h-11',
        // Phone: stacked, full width, primary last (bottom).
        'max-md:-mx-4 max-md:flex-col max-md:px-4 max-md:[&>button]:w-full',
        className,
      )}
    >
      {children}
    </div>
  )
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
  const isMobile = useIsMobile()
  const guard = useDirtyGuard(onClose)
  useOverlayBehavior(open, guard.requestClose, panelRef, closeButtonRef)
  useScrollLock(open && isMobile)

  if (!open) return null

  return (
    <div
      className="qth-animate-in fixed inset-0 z-50 flex items-end justify-center bg-[var(--overlay-backdrop)] backdrop-blur-sm md:items-center md:p-4"
      style={{ animation: 'qth-fade-in 0.15s ease-out' }}
      onClick={guard.requestClose}
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
          // Dashboard redesign Phase 3: raised tactile panel (no texture --
          // that's reserved for Dashboard hero widgets, a dialog full of
          // form fields is a different density) instead of the flat
          // shadow-xl card, so overlays feel consistent with the rest of
          // the tactile language.
          'qth-animate-in qth-raised-lg relative flex max-h-[90vh] w-full max-w-lg flex-col rounded-xl border border-[var(--border)] bg-[var(--tactile-surface-raised)]',
          // Phone: bottom sheet.
          'max-md:max-h-[92svh] max-md:max-w-none max-md:rounded-b-none max-md:rounded-t-2xl max-md:border-b-0 max-md:pb-[env(safe-area-inset-bottom)]',
          className,
        )}
        style={{
          animation: isMobile ? 'qth-sheet-in 0.2s ease-out' : 'qth-scale-in 0.16s ease-out',
        }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <button
          ref={closeButtonRef}
          type="button"
          onClick={guard.requestClose}
          aria-label="Close dialog"
          inert={guard.confirming}
          className="absolute right-2 top-1.5 z-20 flex size-11 items-center justify-center rounded-md text-[var(--muted-foreground)] transition-colors hover:bg-[var(--muted)] hover:text-[var(--foreground)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--ring)] max-md:right-1.5 max-md:top-2"
        >
          <X className="size-4 max-md:size-5" />
        </button>
        <div
          aria-hidden="true"
          className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-[var(--border)] md:hidden"
        />
        <h2 className="shrink-0 border-b border-[var(--border)] px-6 py-4 pr-16 text-sm font-semibold max-md:px-4 max-md:text-base">
          {title}
        </h2>
        <DirtyContext.Provider value={guard.setDirty}>
          <div inert={guard.confirming} className="overflow-y-auto overscroll-contain px-6 py-5 max-md:px-4">
            {children}
          </div>
        </DirtyContext.Provider>
        {guard.confirming && <DiscardPrompt onKeep={guard.keepEditing} onDiscard={guard.discard} />}
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
  const isMobile = useIsMobile()
  const guard = useDirtyGuard(onClose)
  useOverlayBehavior(open, guard.requestClose, panelRef, closeButtonRef)
  useScrollLock(open && isMobile)

  if (!open) return null

  return (
    <div
      className="qth-animate-in fixed inset-0 z-50 flex justify-end bg-[var(--overlay-backdrop)] backdrop-blur-sm"
      style={{ animation: 'qth-fade-in 0.15s ease-out' }}
      onClick={guard.requestClose}
      role="presentation"
    >
      <div
        ref={panelRef}
        className={cn(
          // Dashboard redesign Phase 3: same raised tactile surface as Dialog.
          'qth-animate-in qth-raised-lg relative flex h-full w-full max-w-2xl flex-col border-l border-[var(--border)] bg-[var(--tactile-surface-raised)]',
          className,
        )}
        style={{ animation: 'qth-drawer-in 0.2s ease-out' }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-[var(--border)] px-6 py-4 max-md:px-4 max-md:py-2 max-md:pt-[max(0.5rem,env(safe-area-inset-top))]">
          <h2 className="text-sm font-semibold">{title}</h2>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={guard.requestClose}
            aria-label="Close panel"
            inert={guard.confirming}
            className="rounded-md p-1.5 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--muted)] hover:text-[var(--foreground)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--ring)] max-md:flex max-md:size-11 max-md:items-center max-md:justify-center max-md:p-0"
          >
            <X className="size-4" />
          </button>
        </div>
        <DirtyContext.Provider value={guard.setDirty}>
          <div
            inert={guard.confirming}
            className="flex-1 overflow-y-auto overscroll-contain px-6 py-5 max-md:px-4 max-md:pb-[calc(1.25rem+env(safe-area-inset-bottom))]"
          >
            {children}
          </div>
        </DirtyContext.Provider>
        {guard.confirming && <DiscardPrompt onKeep={guard.keepEditing} onDiscard={guard.discard} />}
      </div>
    </div>
  )
}
