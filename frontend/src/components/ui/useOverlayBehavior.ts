import { useEffect, useRef } from 'react'

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'

// Overlays can stack (a confirmation opened from inside a dialog). Only the
// topmost one may react to Escape/Tab, otherwise Escape closes both and the
// lower trap pulls focus out of the confirmation.
const overlayStack: symbol[] = []

// Shared focus-trap/Escape/return-focus behavior for both Dialog (centered
// modal) and Drawer (side panel) -- UI/UX review bug #2's fix, factored out
// so the two surfaces never drift out of sync with each other.
export function useOverlayBehavior(
  open: boolean,
  onClose: () => void,
  panelRef: React.RefObject<HTMLDivElement | null>,
  closeButtonRef: React.RefObject<HTMLButtonElement | null>,
) {
  const triggerElementRef = useRef<HTMLElement | null>(null)
  // Callers routinely pass an inline `() => setOpen(false)`. Keeping onClose in
  // a ref means a parent re-render (typing, changing a <select> inside the
  // overlay...) does not tear the effect down and rebuild it -- which used to
  // yank focus back to the trigger and then onto the close button on every
  // keystroke/selection. Only opening or closing re-runs the effect.
  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
  })

  useEffect(() => {
    if (!open) return

    triggerElementRef.current = document.activeElement as HTMLElement | null
    const focusTimer = window.setTimeout(() => closeButtonRef.current?.focus(), 0)
    const id = Symbol('overlay')
    overlayStack.push(id)

    function handleKeyDown(event: KeyboardEvent) {
      if (overlayStack[overlayStack.length - 1] !== id) return
      if (event.key === 'Escape') {
        event.stopPropagation()
        onCloseRef.current()
        return
      }
      if (event.key !== 'Tab') return

      const panel = panelRef.current
      if (!panel) return
      const focusable = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
        (el) => el.offsetParent !== null && !el.closest('[inert]'),
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
      const index = overlayStack.indexOf(id)
      if (index !== -1) overlayStack.splice(index, 1)
      document.removeEventListener('keydown', handleKeyDown, true)
      triggerElementRef.current?.focus?.()
    }
  }, [open, panelRef, closeButtonRef])
}
