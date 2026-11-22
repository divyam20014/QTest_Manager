import { SlidersHorizontal } from 'lucide-react'
import { type ReactNode, useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import { Button } from '@/components/ui/button'

const PANEL_WIDTH = 384

/**
 * The "Filters" button with its active-count badge and the panel holding every
 * filter control. The panel is portalled and fixed-positioned under the
 * button (never clipped by a scrolling table wrapper), closes on Escape or an
 * outside click and returns focus to the button. Filters apply live, so the
 * footer only offers "Clear filters" and "Done".
 */
export function FilterPopover({
  activeCount,
  onClear,
  children,
}: {
  activeCount: number
  onClear: () => void
  children: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const panelId = useId()

  const place = useCallback(() => {
    const rect = buttonRef.current?.getBoundingClientRect()
    if (!rect) return
    const width = Math.min(PANEL_WIDTH, window.innerWidth - 16)
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8))
    setPos({ top: rect.bottom + 6, left })
  }, [])

  useLayoutEffect(() => {
    if (open) place()
  }, [open, place])

  const close = useCallback((returnFocus: boolean) => {
    setOpen(false)
    setPos(null)
    if (returnFocus) buttonRef.current?.focus()
  }, [])

  useEffect(() => {
    if (!open) return
    function onKey(event: KeyboardEvent) {
      if (event.key !== 'Escape') return
      // An open select/menu popup inside the panel owns this Escape first.
      const focused = document.activeElement
      if (
        focused !== buttonRef.current &&
        (focused?.closest('[data-overlay-popup]') || focused?.matches('[aria-haspopup][aria-expanded="true"]'))
      ) {
        return
      }
      event.stopPropagation()
      close(true)
    }
    function onDown(event: MouseEvent) {
      const target = event.target as Node
      if (panelRef.current?.contains(target) || buttonRef.current?.contains(target)) return
      close(false)
    }
    document.addEventListener('keydown', onKey, true)
    document.addEventListener('mousedown', onDown)
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      document.removeEventListener('keydown', onKey, true)
      document.removeEventListener('mousedown', onDown)
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [open, close, place])

  // Focus the first control when the panel appears; tab order then follows the DOM.
  const placed = pos !== null
  useEffect(() => {
    if (!open || !placed) return
    panelRef.current
      ?.querySelector<HTMLElement>('input:not([disabled]), button:not([disabled]), select:not([disabled])')
      ?.focus()
  }, [open, placed])

  return (
    <>
      <Button
        ref={buttonRef}
        type="button"
        variant="outline"
        size="sm"
        onClick={() => (open ? close(false) : setOpen(true))}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        className="relative shrink-0 gap-2"
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
      {open &&
        pos &&
        createPortal(
          <div
            ref={panelRef}
            id={panelId}
            role="dialog"
            aria-label="Filters"
            style={{
              position: 'fixed',
              top: pos.top,
              left: pos.left,
              width: Math.min(PANEL_WIDTH, window.innerWidth - 16),
            }}
            className="qth-animate-in z-40 flex flex-col gap-4 rounded-lg border border-[var(--border)] bg-[var(--background)] p-4 shadow-lg [&_[data-combobox-root]]:w-full [&_input:not([type=checkbox]):not([type=radio])]:w-full"
          >
            {children}
            <div className="flex justify-end gap-2 border-t border-[var(--border)] pt-3">
              <Button type="button" variant="outline" size="sm" disabled={activeCount === 0} onClick={onClear}>
                Clear filters
              </Button>
              <Button type="button" size="sm" onClick={() => close(true)}>
                Done
              </Button>
            </div>
          </div>,
          document.body,
        )}
    </>
  )
}
