import { Bot, LogOut, Palette, UserCog } from 'lucide-react'
import { type KeyboardEvent, useEffect, useId, useRef, useState } from 'react'
import { Link } from 'react-router-dom'

import { AIAssistantPanel } from '@/components/AIAssistantPanel'
import { AppearanceDialog } from '@/components/ThemeToggle'
import { initialsOf } from '@/lib/initials'

const ITEM =
  'flex min-h-9 w-full items-center gap-2 rounded-md px-2 text-left text-sm hover:bg-[var(--muted)] focus-visible:bg-[var(--muted)] focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--ring)]'

/**
 * The one account control in the top bar (ADR-121): profile, appearance, the AI assistant
 * and sign out. Appearance and Ask AI used to be two more icons beside it; they live here
 * so the bar stays calm. A disclosure menu (aria-expanded), not role=menu, so My Account
 * stays a real link.
 */
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
  const [appearanceOpen, setAppearanceOpen] = useState(false)
  const [aiOpen, setAiOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const menuId = useId()

  useEffect(() => {
    function onClickOutside(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    function onKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === 'Escape') {
        setOpen((wasOpen) => {
          if (wasOpen) triggerRef.current?.focus()
          return false
        })
      }
    }
    document.addEventListener('mousedown', onClickOutside)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onClickOutside)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [])

  function onPanelKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    const items = Array.from(panelRef.current?.querySelectorAll<HTMLElement>('a, button') ?? [])
    if (items.length === 0) return
    event.preventDefault()
    const at = items.indexOf(document.activeElement as HTMLElement)
    const next = event.key === 'ArrowDown' ? (at + 1) % items.length : (at - 1 + items.length) % items.length
    items[next].focus()
  }

  // UX-006: the visible text (the name, shown from 1440px up) must be the start of the
  // accessible name (WCAG 2.5.3 Label in Name). Below that the button is the avatar alone.
  const accessibleName = name ? `${name}${role ? ` · ${role}` : ''} account menu` : 'Account menu'

  return (
    <div ref={ref} className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={accessibleName}
        onClick={() => setOpen((v) => !v)}
        className="flex h-9 items-center gap-2 rounded-[var(--radius-control)] px-1 text-sm hover:bg-[var(--muted)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)] min-[1440px]:pr-2"
      >
        {/* Initials come from a pseudo-element, not text, so the visible label is only the name. */}
        <span
          aria-hidden="true"
          data-initials={initialsOf(name)}
          className="flex size-7 shrink-0 items-center justify-center rounded-full bg-[var(--muted)] text-xs font-semibold text-[var(--foreground)] before:content-[attr(data-initials)]"
        />
        <span data-testid="account-name" className="hidden max-w-[8rem] truncate text-[var(--foreground)] min-[1440px]:inline">{name}</span>
      </button>
      {open && (
        <div
          id={menuId}
          ref={panelRef}
          onKeyDown={onPanelKeyDown}
          className="absolute right-0 top-full z-[var(--z-dropdown)] mt-2 w-56 rounded-lg border border-[var(--border)] bg-[var(--tactile-surface-raised)] p-1.5 shadow-md"
        >
          <div className="px-2 py-1.5 text-xs text-[var(--muted-foreground)]">
            Signed in as <span className="font-medium text-[var(--foreground)]">{name}</span>
            {role && <span className="block capitalize">{role}</span>}
          </div>
          <Link to="/account" onClick={() => setOpen(false)} className={ITEM}>
            <UserCog className="size-4" aria-hidden="true" />
            My Account
          </Link>
          <button
            type="button"
            aria-haspopup="dialog"
            onClick={() => {
              setOpen(false)
              setAppearanceOpen(true)
            }}
            className={ITEM}
          >
            <Palette className="size-4" aria-hidden="true" />
            Appearance
          </button>
          <button
            type="button"
            aria-haspopup="dialog"
            onClick={() => {
              setOpen(false)
              setAiOpen(true)
            }}
            className={ITEM}
          >
            <Bot className="size-4" aria-hidden="true" />
            Ask AI
          </button>
          <div role="separator" className="my-1 border-t border-[var(--border)]" />
          <button type="button" onClick={onLogout} className={ITEM}>
            <LogOut className="size-4" aria-hidden="true" />
            Sign out
          </button>
        </div>
      )}
      <AppearanceDialog open={appearanceOpen} onClose={() => setAppearanceOpen(false)} />
      <AIAssistantPanel hideTrigger open={aiOpen} onOpenChange={setAiOpen} />
    </div>
  )
}
