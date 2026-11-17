import { type KeyboardEvent, useRef } from 'react'

import { filterTabId } from '@/components/ui/filterTabId'
import { cn } from '@/lib/utils'

export interface FilterTab {
  key: string
  label: string
  /** Shown beside the label when known. */
  count?: number
}

/**
 * A controlled tab strip that filters one list (the Defects status tabs),
 * as opposed to `Tabs`, which owns and swaps its own content. Same WAI-ARIA
 * tabs keyboard model as `Tabs` (roving tabindex, arrows / Home / End); the
 * caller renders the single panel and gives it `id={panelId}`,
 * `role="tabpanel"` and `aria-labelledby={filterTabId(panelId, value)}`.
 */
export function FilterTabs({
  label,
  items,
  value,
  onChange,
  panelId,
  className,
}: {
  label: string
  items: FilterTab[]
  value: string
  onChange: (key: string) => void
  panelId: string
  className?: string
}) {
  const refs = useRef<Record<string, HTMLButtonElement | null>>({})

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let next = -1
    if (event.key === 'ArrowRight') next = (index + 1) % items.length
    else if (event.key === 'ArrowLeft') next = (index - 1 + items.length) % items.length
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = items.length - 1
    if (next < 0) return
    event.preventDefault()
    const target = items[next]
    onChange(target.key)
    refs.current[target.key]?.focus()
  }

  return (
    <div
      role="tablist"
      aria-label={label}
      className={cn('flex gap-1 overflow-x-auto border-b border-[var(--border)]', className)}
    >
      {items.map((item, index) => {
        const isActive = item.key === value
        return (
          <button
            key={item.key || 'all'}
            type="button"
            role="tab"
            id={filterTabId(panelId, item.key)}
            aria-controls={panelId}
            aria-selected={isActive}
            tabIndex={isActive ? 0 : -1}
            ref={(el) => {
              refs.current[item.key] = el
            }}
            onKeyDown={(e) => handleKeyDown(e, index)}
            onClick={() => onChange(item.key)}
            className={cn(
              'inline-flex h-10 shrink-0 items-center gap-1.5 rounded-t-md border-b-2 px-3 text-sm font-medium transition-colors motion-reduce:transition-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)] max-md:min-h-11',
              isActive
                ? 'qth-raised-sm border-[var(--primary)] bg-[var(--tactile-surface-raised)] text-[var(--foreground)]'
                : 'border-transparent text-[var(--muted-foreground)] hover:text-[var(--foreground)]',
            )}
          >
            {item.label}
            {item.count !== undefined && (
              <span
                className={cn(
                  'rounded-full px-1.5 text-xs tabular-nums',
                  isActive ? 'bg-[var(--muted)] text-[var(--foreground)]' : 'bg-[var(--muted)]',
                )}
              >
                {item.count}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}
