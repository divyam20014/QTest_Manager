import { X } from 'lucide-react'
import { useId, useState, type KeyboardEvent, type ReactNode } from 'react'
import { Link } from 'react-router-dom'

import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { filterOptions, type PickOption } from '@/lib/quickCase'

export interface ChipItem extends PickOption {
  href?: string
}

/**
 * Searchable multi-select (ADR-106): typeahead input (ARIA combobox + listbox) with
 * removable chips. Options are filtered client-side; selecting calls `onAdd`, the chip's
 * remove button calls `onRemove`. Chips can link to the item (`href`).
 */
export function MultiCombobox({
  label,
  options,
  selected,
  onAdd,
  onRemove,
  removeLabel,
  placeholder = 'Type to search…',
  disabled,
  busy,
  emptyText = 'No matches',
  hint,
}: {
  label: ReactNode
  options: PickOption[]
  selected: ChipItem[]
  onAdd: (id: string) => void
  onRemove: (id: string) => void
  removeLabel: (item: ChipItem) => string
  placeholder?: string
  disabled?: boolean
  busy?: boolean
  emptyText?: string
  hint?: ReactNode
}) {
  const uid = useId()
  const listId = `${uid}-list`
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const matches = filterOptions(
    options,
    query,
    selected.map((s) => s.id),
  )
  const showList = open && !disabled
  const activeId = showList && matches[active] ? `${uid}-opt-${matches[active].id}` : undefined

  function choose(id: string) {
    onAdd(id)
    setQuery('')
    setActive(0)
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setOpen(true)
      setActive((a) => Math.min(a + 1, Math.max(matches.length - 1, 0)))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((a) => Math.max(a - 1, 0))
    } else if (e.key === 'Enter' && showList && matches[active]) {
      e.preventDefault()
      choose(matches[active].id)
    } else if (e.key === 'Escape' && showList) {
      e.stopPropagation()
      setOpen(false)
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={`${uid}-input`}>{label}</Label>
      {selected.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" aria-label="Selected">
          {selected.map((s) => (
            <li
              key={s.id}
              className="flex max-w-full items-center gap-1 rounded-full border border-[var(--border)] bg-[var(--muted)] py-0.5 pl-3 pr-0.5 text-sm"
            >
              {s.href ? (
                <Link to={s.href} className="truncate underline-offset-2 hover:underline">
                  {s.label}
                </Link>
              ) : (
                <span className="truncate">{s.label}</span>
              )}
              {!disabled && (
                <button
                  type="button"
                  aria-label={removeLabel(s)}
                  onClick={() => onRemove(s.id)}
                  className="flex size-8 shrink-0 items-center justify-center rounded-full text-[var(--muted-foreground)] hover:bg-[var(--border)] hover:text-[var(--foreground)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--ring)] max-md:size-11"
                >
                  <X className="size-4" aria-hidden="true" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {!disabled && (
        <div className="relative">
          <Input
            id={`${uid}-input`}
            role="combobox"
            aria-expanded={showList}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={activeId}
            aria-busy={busy || undefined}
            autoComplete="off"
            placeholder={placeholder}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setOpen(true)
              setActive(0)
            }}
            onFocus={() => setOpen(true)}
            onBlur={() => setOpen(false)}
            onKeyDown={onKeyDown}
          />
          {showList && (
            <ul
              id={listId}
              role="listbox"
              aria-label={typeof label === 'string' ? label : 'Options'}
              className="qth-raised-lg absolute z-30 mt-1 max-h-56 w-full overflow-y-auto rounded-md border border-[var(--border)] bg-[var(--tactile-surface-raised)] p-1 text-sm"
            >
              {matches.length === 0 ? (
                <li
                  role="option"
                  aria-disabled="true"
                  aria-selected="false"
                  className="px-3 py-2 text-[var(--muted-foreground)]"
                >
                  {emptyText}
                </li>
              ) : (
                matches.map((o, i) => (
                  <li
                    key={o.id}
                    id={`${uid}-opt-${o.id}`}
                    role="option"
                    aria-selected={i === active}
                    // mousedown (not click) so the input's blur doesn't close the list first.
                    onMouseDown={(e) => {
                      e.preventDefault()
                      choose(o.id)
                    }}
                    onMouseEnter={() => setActive(i)}
                    className={`cursor-pointer rounded-md px-3 py-2 max-md:min-h-11 ${i === active ? 'bg-[var(--muted)]' : ''}`}
                  >
                    {o.label}
                  </li>
                ))
              )}
            </ul>
          )}
        </div>
      )}
      {hint && <p className="text-xs text-[var(--muted-foreground)]">{hint}</p>}
    </div>
  )
}
