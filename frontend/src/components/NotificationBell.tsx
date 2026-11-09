import { Bell } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'

// No backend notification feed exists yet -- this is the shell-level
// affordance so the UI has a place for one to land later. It intentionally
// shows an honest empty state rather than fabricated items.
export function NotificationBell() {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onClickOutside(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [])

  return (
    <div ref={ref} className="relative">
      <Button
        variant="ghost"
        size="sm"
        aria-label="Notifications"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <Bell className="size-4" />
      </Button>
      {open && (
        <div className="absolute right-0 top-full z-10 mt-2 w-64 rounded-md border border-[var(--border)] bg-[var(--background)] p-3 shadow-md">
          <p className="text-sm text-[var(--muted-foreground)]">No new notifications.</p>
        </div>
      )}
    </div>
  )
}
