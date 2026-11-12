import { type ReactNode, useEffect, useRef, useState } from 'react'

import { cn } from '@/lib/utils'

export interface RowContextMenuItem {
  label: string
  onSelect: () => void
  destructive?: boolean
  disabled?: boolean
}

/**
 * Right-click context menu for a table row. Purely additive -- reuses
 * whatever handlers the row's existing inline actions already call,
 * never a replacement for them (existing buttons/links are untouched).
 */
export function useRowContextMenu() {
  const [state, setState] = useState<{ x: number; y: number; items: RowContextMenuItem[] } | null>(null)

  function openAt(event: React.MouseEvent, items: RowContextMenuItem[]) {
    event.preventDefault()
    setState({ x: event.clientX, y: event.clientY, items })
  }

  function close() {
    setState(null)
  }

  const menu: ReactNode = state && (
    <RowContextMenuPortal x={state.x} y={state.y} items={state.items} onClose={close} />
  )

  return { openAt, menu }
}

function RowContextMenuPortal({
  x,
  y,
  items,
  onClose,
}: {
  x: number
  y: number
  items: RowContextMenuItem[]
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClick(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) onClose()
    }
    function handleKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', handleClick)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('keydown', handleKey)
    }
  }, [onClose])

  return (
    <div
      ref={ref}
      role="menu"
      className="qth-animate-in fixed z-50 min-w-[160px] rounded-md border border-[var(--border)] bg-[var(--background)] p-1 shadow-lg"
      style={{ left: x, top: y, animation: 'qth-fade-in 0.1s ease-out' }}
    >
      {items.map((item) => (
        <button
          key={item.label}
          type="button"
          role="menuitem"
          disabled={item.disabled}
          onClick={() => {
            item.onSelect()
            onClose()
          }}
          className={cn(
            'block w-full rounded px-3 py-1.5 text-left text-sm hover:bg-[var(--muted)] disabled:opacity-50',
            item.destructive && 'text-[var(--destructive)]',
          )}
        >
          {item.label}
        </button>
      ))}
    </div>
  )
}
