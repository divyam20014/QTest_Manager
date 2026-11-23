import { Columns3 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import type { ColumnMode, ColumnSpecLike } from '@/lib/columnModes'
import { cn } from '@/lib/utils'
import type { TableDensity } from './tablePrefs'

const MODES: { value: ColumnMode; label: string }[] = [
  { value: 'default', label: 'Default' },
  { value: 'all', label: 'All fields' },
  { value: 'custom', label: 'Custom' },
]

/**
 * Column picker of the field-standard lists (Test Cases, Defects): three modes (Default / All fields /
 * Custom), a checklist built from the list's field catalogue (ticking a box switches to Custom), and
 * the shared row-density toggle. Which columns a saved view stores is whatever is shown here.
 */
export function ColumnModeMenu({
  columns,
  keys,
  mode,
  onMode,
  onToggle,
  density,
  setDensity,
  modeHelp,
  idPrefix,
}: {
  /** Every column the picker offers (the catalogue's fields, then the extras). */
  columns: ColumnSpecLike[]
  keys: string[]
  mode: ColumnMode
  onMode: (mode: ColumnMode) => void
  onToggle: (key: string) => void
  density?: TableDensity
  setDensity?: (density: TableDensity) => void
  /** One line of help under the mode switch, per mode. */
  modeHelp: Record<ColumnMode, string>
  /** Prefix of the radio group names (unique per list). */
  idPrefix: string
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    function onDown(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false)
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setOpen(false)
        buttonRef.current?.focus()
      }
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div ref={ref} className="relative">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="true"
        aria-expanded={open}
        className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--border)] px-2.5 text-xs text-[var(--muted-foreground)] transition-colors hover:bg-[var(--muted)] hover:text-[var(--foreground)] max-md:min-h-11"
      >
        <Columns3 className="size-3.5" aria-hidden="true" />
        Columns
        <span className="rounded-full bg-[var(--muted)] px-1.5 tabular-nums text-[var(--foreground)]">{keys.length}</span>
      </button>
      {open && (
        <div
          role="dialog"
          aria-label="Choose columns"
          className="absolute right-0 top-full z-30 mt-1 w-72 max-w-[calc(100vw-2rem)] rounded-md border border-[var(--border)] bg-[var(--background)] p-2 shadow-lg"
        >
          <fieldset className="border-b border-[var(--border)] pb-2">
            <legend className="mb-1 px-0.5 text-xs text-[var(--muted-foreground)]">Column set</legend>
            <div className="flex gap-1">
              {MODES.map((m) => (
                <label
                  key={m.value}
                  className={cn(
                    'flex flex-1 cursor-pointer items-center justify-center rounded-md border border-[var(--border)] px-2 py-1.5 text-xs has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-[var(--ring)] max-md:min-h-11',
                    mode === m.value ? 'bg-[var(--primary)] text-[var(--primary-foreground)]' : 'hover:bg-[var(--muted)]',
                  )}
                >
                  <input
                    type="radio"
                    name={`${idPrefix}-column-mode`}
                    value={m.value}
                    checked={mode === m.value}
                    onChange={() => onMode(m.value)}
                    className="sr-only"
                  />
                  {m.label}
                </label>
              ))}
            </div>
            <p className="mt-1 px-0.5 text-xs text-[var(--muted-foreground)]">{modeHelp[mode]}</p>
          </fieldset>
          <ul className="mt-1 flex max-h-64 flex-col overflow-y-auto" aria-label="Columns">
            {columns.map((col) => (
              <li key={col.key}>
                <label className="flex min-h-9 cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-sm hover:bg-[var(--muted)] max-md:min-h-11">
                  <input type="checkbox" checked={keys.includes(col.key)} onChange={() => onToggle(col.key)} />
                  {col.label}
                </label>
              </li>
            ))}
          </ul>
          {setDensity && (
            <fieldset className="mt-1 border-t border-[var(--border)] px-0.5 pt-2 max-md:hidden">
              <legend className="mb-1 px-0.5 text-xs text-[var(--muted-foreground)]">Row density</legend>
              <div className="flex gap-1">
                {(['comfortable', 'compact'] as const).map((value) => (
                  <label
                    key={value}
                    className={cn(
                      'flex flex-1 cursor-pointer items-center justify-center rounded-md border border-[var(--border)] px-2 py-1 text-xs capitalize has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-[var(--ring)]',
                      density === value ? 'bg-[var(--primary)] text-[var(--primary-foreground)]' : 'hover:bg-[var(--muted)]',
                    )}
                  >
                    <input
                      type="radio"
                      name={`${idPrefix}-density`}
                      value={value}
                      checked={density === value}
                      onChange={() => setDensity(value)}
                      className="sr-only"
                    />
                    {value}
                  </label>
                ))}
              </div>
            </fieldset>
          )}
        </div>
      )}
    </div>
  )
}
