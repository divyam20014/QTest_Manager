import { ListFilter } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

export function SavedFiltersMenu<T extends Record<string, string>>({
  current,
  saved,
  onSave,
  onApply,
  onRemove,
}: {
  current: T
  saved: Record<string, T>
  onSave: (name: string, filters: T) => void
  onApply: (filters: T) => void
  onRemove: (name: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const ref = useRef<HTMLDivElement>(null)
  const names = Object.keys(saved)

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

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="true"
        aria-expanded={open}
        className="inline-flex items-center gap-1.5 rounded-md border border-[var(--border)] px-2.5 py-1.5 text-xs text-[var(--muted-foreground)] transition-colors hover:bg-[var(--muted)] hover:text-[var(--foreground)]"
      >
        <ListFilter className="size-3.5" />
        Saved filters
      </button>
      {open && (
        <div
          role="menu"
          className="qth-animate-in absolute right-0 top-full z-30 mt-1 w-64 rounded-md border border-[var(--border)] bg-[var(--background)] p-2 shadow-lg"
          style={{ animation: 'qth-fade-in 0.1s ease-out' }}
        >
          {names.length === 0 && (
            <p className="px-1 py-1 text-xs text-[var(--muted-foreground)]">No saved filter combinations yet.</p>
          )}
          {names.map((n) => (
            <div key={n} className="flex items-center justify-between gap-1 rounded px-1 py-1 hover:bg-[var(--muted)]">
              <button
                type="button"
                onClick={() => {
                  onApply(saved[n])
                  setOpen(false)
                }}
                className="flex-1 truncate text-left text-sm"
              >
                {n}
              </button>
              <button
                type="button"
                aria-label={`Delete saved filter ${n}`}
                onClick={() => onRemove(n)}
                className="rounded px-1.5 text-xs text-[var(--muted-foreground)] hover:text-[var(--destructive)]"
              >
                ×
              </button>
            </div>
          ))}
          <div className="mt-2 flex gap-1 border-t border-[var(--border)] pt-2">
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Name this view…"
              className="min-w-0 flex-1 rounded-md border border-[var(--border)] bg-[var(--background)] px-2 py-1 text-xs outline-none focus:ring-2 focus:ring-[var(--ring)]"
            />
            <button
              type="button"
              disabled={!name.trim()}
              onClick={() => {
                onSave(name.trim(), current)
                setName('')
              }}
              className="shrink-0 rounded-md bg-[var(--primary)] px-2 py-1 text-xs font-medium text-[var(--primary-foreground)] disabled:opacity-50"
            >
              Save current
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
