import { Columns3 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { cn } from '@/lib/utils'
import type { TableColumnDef } from './tablePrefs'

export function ColumnVisibilityMenu({
  columns,
  isVisible,
  toggleVisible,
  showAll,
}: {
  columns: TableColumnDef[]
  isVisible: (key: string) => boolean
  toggleVisible: (key: string) => void
  showAll: () => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const optional = columns.filter((c) => !c.alwaysVisible)

  useEffect(() => {
    if (!open) return
    function handleClick(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false)
    }
    function handleKey(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('keydown', handleKey)
    }
  }, [open])

  if (optional.length === 0) return null

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="true"
        aria-expanded={open}
        className="inline-flex items-center gap-1.5 rounded-md border border-[var(--border)] px-2.5 py-1.5 text-xs text-[var(--muted-foreground)] transition-colors hover:bg-[var(--muted)] hover:text-[var(--foreground)]"
      >
        <Columns3 className="size-3.5" />
        Columns
      </button>
      {open && (
        <div
          role="menu"
          className="qth-animate-in absolute right-0 top-full z-30 mt-1 w-48 rounded-md border border-[var(--border)] bg-[var(--background)] p-1.5 shadow-lg"
          style={{ animation: 'qth-fade-in 0.1s ease-out' }}
        >
          {optional.map((col) => (
            <label
              key={col.key}
              className={cn(
                'flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-[var(--muted)]',
              )}
            >
              <input type="checkbox" checked={isVisible(col.key)} onChange={() => toggleVisible(col.key)} />
              {col.label}
            </label>
          ))}
          <div className="mt-1 border-t border-[var(--border)] pt-1">
            <button
              type="button"
              onClick={showAll}
              className="w-full rounded px-2 py-1.5 text-left text-xs text-[var(--muted-foreground)] hover:bg-[var(--muted)]"
            >
              Show all columns
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
