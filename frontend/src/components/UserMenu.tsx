import { LogOut, User as UserIcon, UserCog } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import { Link } from 'react-router-dom'

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
  const menuId = useId()

  useEffect(() => {
    function onClickOutside(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onClickOutside)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onClickOutside)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [])

  // UX-006: the visible text ("Name · role", shown from xl up) must be the
  // start of the accessible name (WCAG 2.5.3 Label in Name). Below xl the
  // button is icon-only, so the name is the same phrase without relying on
  // visible text.
  const visibleText = name ? `${name}${role ? ` · ${role}` : ''}` : ''
  const accessibleName = visibleText ? `${visibleText} account menu` : 'Account menu'

  return (
    <div ref={ref} className="relative">
      <Button
        variant="ghost"
        size="sm"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={accessibleName}
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2"
      >
        <span className="flex size-6 items-center justify-center rounded-full bg-[var(--muted)]">
          <UserIcon className="size-3.5" />
        </span>
        <span className="hidden text-[var(--muted-foreground)] xl:inline">{visibleText}</span>
      </Button>
      {open && (
        <div
          id={menuId}
          className="absolute right-0 top-full z-[30] mt-2 w-52 rounded-lg border border-[var(--border)] bg-[var(--tactile-surface-raised)] p-1.5 shadow-md"
        >
          <div className="px-2 py-1.5 text-xs text-[var(--muted-foreground)]">
            Signed in as <span className="font-medium text-[var(--foreground)]">{name}</span>
            {role && <span className="block capitalize">{role}</span>}
          </div>
          <Link
            to="/account"
            onClick={() => setOpen(false)}
            className="flex min-h-10 w-full items-center gap-2 rounded-md px-2 text-left text-sm hover:bg-[var(--muted)] focus-visible:bg-[var(--muted)]"
          >
            <UserCog className="size-4" />
            My Account
          </Link>
          <button
            type="button"
            onClick={onLogout}
            className="flex min-h-10 w-full items-center gap-2 rounded-md px-2 text-left text-sm hover:bg-[var(--muted)] focus-visible:bg-[var(--muted)]"
          >
            <LogOut className="size-4" />
            Logout
          </button>
        </div>
      )}
    </div>
  )
}
