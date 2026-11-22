import { type KeyboardEvent, type ReactNode, type Ref, useEffect, useId, useRef, useState } from 'react'

import { cn } from '@/lib/utils'

export type DropdownMenuItem =
  | { type: 'separator' }
  | {
      type?: 'item'
      label: string
      onSelect: () => void
      icon?: ReactNode
      shortcut?: string
      destructive?: boolean
      disabled?: boolean
    }

export interface MenuTriggerProps {
  ref: Ref<HTMLButtonElement>
  id: string
  'aria-haspopup': 'menu'
  'aria-expanded': boolean
  'aria-controls': string | undefined
  onClick: () => void
  onKeyDown: (e: KeyboardEvent<HTMLButtonElement>) => void
}

/**
 * Trigger + menu (role=menu / menuitem, roving focus). The trigger is a render
 * prop so any button (e.g. IconButton) can be used; spread the props on it.
 * Escape closes and returns focus to the trigger; it is honoured inside
 * Dialogs because useOverlayBehavior skips Escape while a popup has focus.
 */
export function DropdownMenu({
  trigger,
  items,
  label,
  align = 'end',
  className,
}: {
  trigger: (props: MenuTriggerProps) => ReactNode
  items: DropdownMenuItem[]
  /** Accessible name of the menu. */
  label: string
  align?: 'start' | 'end'
  className?: string
}) {
  const uid = useId()
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLSpanElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const pendingFocus = useRef<'first' | 'last'>('first')

  const entries = (): HTMLElement[] =>
    Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])') ?? [])

  useEffect(() => {
    if (!open) return
    const list = entries()
    ;(pendingFocus.current === 'last' ? list[list.length - 1] : list[0])?.focus()
    function onDown(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  function close(refocus = true) {
    setOpen(false)
    if (refocus) triggerRef.current?.focus()
  }

  function onTriggerKeyDown(e: KeyboardEvent<HTMLButtonElement>) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      pendingFocus.current = e.key === 'ArrowUp' ? 'last' : 'first'
      setOpen(true)
    }
  }

  function onMenuKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const list = entries()
    const i = list.indexOf(document.activeElement as HTMLElement)
    let next: HTMLElement | undefined
    if (e.key === 'ArrowDown') next = list[(i + 1) % list.length]
    else if (e.key === 'ArrowUp') next = list[(i - 1 + list.length) % list.length]
    else if (e.key === 'Home') next = list[0]
    else if (e.key === 'End') next = list[list.length - 1]
    else if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      close()
      return
    } else if (e.key === 'Tab') {
      close(false)
      return
    } else return
    e.preventDefault()
    next?.focus()
  }

  return (
    <span ref={rootRef} className={cn('relative inline-flex', className)}>
      {trigger({
        ref: triggerRef,
        id: `${uid}-trigger`,
        'aria-haspopup': 'menu',
        'aria-expanded': open,
        'aria-controls': open ? `${uid}-menu` : undefined,
        onClick: () => {
          pendingFocus.current = 'first'
          setOpen((o) => !o)
        },
        onKeyDown: onTriggerKeyDown,
      })}
      {open && (
        <div
          ref={menuRef}
          id={`${uid}-menu`}
          role="menu"
          aria-label={label}
          data-overlay-popup
          onKeyDown={onMenuKeyDown}
          className={cn(
            'absolute top-full z-[var(--z-dropdown)] mt-1 min-w-48 rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--tactile-surface-raised)] p-1 text-sm shadow-lg',
            align === 'end' ? 'right-0' : 'left-0',
          )}
        >
          {items.map((item, i) =>
            item.type === 'separator' ? (
              <div key={`sep-${i}`} role="separator" className="my-1 h-px bg-[var(--border)]" />
            ) : (
              <div
                key={`${item.label}-${i}`}
                role="menuitem"
                tabIndex={-1}
                aria-disabled={item.disabled || undefined}
                onClick={() => {
                  if (item.disabled) return
                  close()
                  item.onSelect()
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    e.currentTarget.click()
                  }
                }}
                className={cn(
                  'flex min-h-8 cursor-pointer items-center gap-2 rounded-md px-2.5 py-1.5 outline-none max-md:min-h-11',
                  'hover:bg-[var(--muted)] focus-visible:bg-[var(--muted)] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--ring)]',
                  item.destructive && 'text-[var(--destructive)]',
                  item.disabled && 'cursor-not-allowed opacity-50',
                )}
              >
                {item.icon && (
                  <span aria-hidden="true" className="flex size-4 shrink-0 items-center justify-center [&_svg]:size-4">
                    {item.icon}
                  </span>
                )}
                <span className="flex-1 truncate">{item.label}</span>
                {item.shortcut && <kbd className="text-xs text-[var(--muted-foreground)]">{item.shortcut}</kbd>}
              </div>
            ),
          )}
        </div>
      )}
    </span>
  )
}
