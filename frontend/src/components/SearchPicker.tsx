import { useQuery } from '@tanstack/react-query'
import { Search } from 'lucide-react'
import { useId, useState, type KeyboardEvent, type ReactNode } from 'react'

import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useDebouncedValue } from '@/lib/useDebouncedValue'
import { cn } from '@/lib/utils'

export interface PickItem {
  id: string
  /** The identifying part, shown in a monospace face (e.g. "TC_000012"). */
  primary: string
  /** The descriptive part (e.g. the title). */
  secondary: string
  /** Optional right-aligned detail (a status, a module). */
  detail?: ReactNode
}

/**
 * Searchable single-pick list backed by the server (ARIA combobox + listbox): the typed text is
 * debounced and sent to `search`, already-chosen ids are hidden, picking calls `onPick` and clears
 * the box. Used to link test cases to a defect and to link an existing defect to a run case. The
 * parent keeps the chosen items (chips, table rows); this component only finds and offers them.
 */
export function SearchPicker({
  id,
  label,
  queryKey,
  search,
  excludeIds = [],
  onPick,
  placeholder = 'Search…',
  emptyText = 'No matches',
  disabled,
  hint,
  required,
}: {
  id: string
  label: ReactNode
  /** Distinguishes this picker's cache entries (include the scope, e.g. the project id). */
  queryKey: readonly unknown[]
  search: (query: string) => Promise<PickItem[]>
  excludeIds?: string[]
  onPick: (item: PickItem) => void
  placeholder?: string
  emptyText?: string
  disabled?: boolean
  hint?: ReactNode
  required?: boolean
}) {
  const uid = useId()
  const listId = `${uid}-list`
  const [text, setText] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const debounced = useDebouncedValue(text.trim(), 250)
  const query = useQuery({
    queryKey: ['search-picker', ...queryKey, debounced],
    queryFn: () => search(debounced),
    enabled: open && !disabled,
    staleTime: 15_000,
  })
  const items = (query.data ?? []).filter((i) => !excludeIds.includes(i.id))
  const showList = open && !disabled
  const activeId = showList && items[active] ? `${uid}-opt-${items[active].id}` : undefined

  function choose(item: PickItem) {
    onPick(item)
    setText('')
    setActive(0)
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setOpen(true)
      setActive((a) => Math.min(a + 1, Math.max(items.length - 1, 0)))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((a) => Math.max(a - 1, 0))
    } else if (e.key === 'Enter') {
      if (showList && items[active]) {
        e.preventDefault()
        choose(items[active])
      }
    } else if (e.key === 'Escape') {
      if (open) {
        e.stopPropagation()
        setOpen(false)
      }
    }
  }

  return (
    <div className="relative flex flex-col gap-1.5">
      <Label htmlFor={id} required={required}>
        {label}
      </Label>
      <div className="relative">
        <Search
          className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-[var(--muted-foreground)]"
          aria-hidden="true"
        />
        <Input
          id={id}
          role="combobox"
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={activeId}
          autoComplete="off"
          disabled={disabled}
          placeholder={placeholder}
          value={text}
          className="pl-8"
          onChange={(e) => {
            setText(e.target.value)
            setOpen(true)
            setActive(0)
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => window.setTimeout(() => setOpen(false), 150)}
          onKeyDown={onKeyDown}
        />
      </div>
      {showList && (
        <ul
          id={listId}
          role="listbox"
          aria-label={typeof label === 'string' ? `${label} results` : 'Results'}
          className="absolute left-0 right-0 top-full z-30 mt-1 max-h-64 overflow-y-auto rounded-md border border-[var(--border)] bg-[var(--background)] p-1 shadow-lg"
        >
          {query.isLoading && <li className="px-2 py-1.5 text-xs text-[var(--muted-foreground)]">Searching…</li>}
          {query.isError && <li className="px-2 py-1.5 text-xs text-[var(--destructive)]">Could not search. Try again.</li>}
          {!query.isLoading && !query.isError && items.length === 0 && (
            <li className="px-2 py-1.5 text-xs text-[var(--muted-foreground)]">{emptyText}</li>
          )}
          {items.map((item, index) => (
            <li
              key={item.id}
              id={`${uid}-opt-${item.id}`}
              role="option"
              aria-selected={index === active}
              // mousedown (not click) so the choice lands before the input's blur closes the list.
              onMouseDown={(e) => {
                e.preventDefault()
                choose(item)
              }}
              onMouseEnter={() => setActive(index)}
              className={cn(
                'flex min-h-9 cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm max-md:min-h-11',
                index === active && 'bg-[var(--muted)]',
              )}
            >
              <span className="shrink-0 font-mono text-xs">{item.primary}</span>
              <span className="min-w-0 flex-1 truncate">{item.secondary}</span>
              {item.detail && <span className="shrink-0 text-xs text-[var(--muted-foreground)]">{item.detail}</span>}
            </li>
          ))}
        </ul>
      )}
      {hint && <p className="text-xs text-[var(--muted-foreground)]">{hint}</p>}
    </div>
  )
}
