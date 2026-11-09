import { LogOut, User as UserIcon } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'

export function UserMenu({
  name,
  role,
  onLogout,
}: {
  name?: string
  role?: string
  onLogout: () => void
}) {
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
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2"
      >
        <span className="flex size-6 items-center justify-center rounded-full bg-[var(--muted)]">
          <UserIcon className="size-3.5" />
        </span>
        <span className="text-[var(--muted-foreground)]">
          {name} · {role}
        </span>
      </Button>
      {open && (
        <div className="absolute right-0 top-full z-10 mt-2 w-48 rounded-md border border-[var(--border)] bg-[var(--background)] p-1 shadow-md">
          <div className="px-2 py-1.5 text-xs text-[var(--muted-foreground)]">
            Signed in as <span className="font-medium text-[var(--foreground)]">{name}</span>
          </div>
          <button
            type="button"
            onClick={onLogout}
            className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-[var(--muted)]"
          >
            <LogOut className="size-4" />
            Logout
          </button>
        </div>
      )}
    </div>
  )
}
