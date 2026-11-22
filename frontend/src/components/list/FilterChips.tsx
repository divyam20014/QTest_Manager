import { X } from 'lucide-react'

import { Button } from '@/components/ui/button'

export interface FilterChip {
  /** URL / state key the chip belongs to. */
  key: string
  /** Filter name, e.g. "Project". */
  label: string
  /** Human readable value, e.g. the project's name. */
  value: string
}

/** Removable chips for the active filters, plus "Clear all". Renders nothing when there are none. */
export function FilterChips({
  chips,
  onRemove,
  onClearAll,
}: {
  chips: FilterChip[]
  onRemove: (key: string) => void
  onClearAll: () => void
}) {
  if (chips.length === 0) return null
  return (
    <ul aria-label="Active filters" className="flex flex-wrap items-center gap-1.5">
      {chips.map((chip) => (
        <li
          key={chip.key}
          className="inline-flex items-center gap-1 rounded-full bg-[var(--muted)] py-0.5 pl-2.5 pr-1 text-xs"
        >
          <span>
            {chip.label}: {chip.value}
          </span>
          <button
            type="button"
            onClick={() => onRemove(chip.key)}
            aria-label={`Remove ${chip.label} filter`}
            className="inline-flex size-5 items-center justify-center rounded-full text-[var(--muted-foreground)] hover:bg-[var(--border)] hover:text-[var(--foreground)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--ring)] max-md:size-8"
          >
            <X className="size-3" aria-hidden="true" />
          </button>
        </li>
      ))}
      <li>
        <Button type="button" variant="ghost" size="sm" onClick={onClearAll}>
          Clear all
        </Button>
      </li>
    </ul>
  )
}
