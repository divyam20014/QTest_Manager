import { type KeyboardEvent, type ReactNode, useEffect, useId, useRef, useState } from 'react'
import { NavLink } from 'react-router-dom'
import { ChevronLeft, ChevronRight } from 'lucide-react'

import { cn } from '@/lib/utils'

export interface TabItem {
  key: string
  label: string
  content: ReactNode
  /** Optional count shown as a small badge after the label. */
  count?: number
}

function CountBadge({ count }: { count: number }) {
  return (
    <span className="ml-2 rounded-full bg-[var(--muted)] px-1.5 text-xs tabular-nums text-[var(--muted-foreground)]">
      {count}
    </span>
  )
}

// Minimal, dependency-free tab strip -- used to break up long
// single-scroll admin pages (Settings) into clearly-separated sections.
// Not a generic routing mechanism: each tab's content stays mounted-only
// when active, so per-tab Save buttons and local state behave exactly as
// they did when everything was one long page, just visually separated.
export function Tabs({ items, defaultKey }: { items: TabItem[]; defaultKey?: string }) {
  const [active, setActive] = useState(defaultKey ?? items[0]?.key)
  const activeItem = items.find((i) => i.key === active) ?? items[0]
  const baseId = useId()
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({})
  const listRef = useRef<HTMLDivElement>(null)
  // ADR-133: which sides of the row have tabs out of sight, so that side can be faded.
  const [more, setMore] = useState({ left: false, right: false })

  function measure() {
    const list = listRef.current
    if (!list) return
    const left = list.scrollLeft > 1
    const right = list.scrollLeft + list.clientWidth < list.scrollWidth - 1
    setMore((m) => (m.left === left && m.right === right ? m : { left, right }))
  }

  // Changes when a tab's width can: counts often arrive after the first paint.
  const signature = items.map((i) => `${i.key}:${i.label}:${i.count ?? ''}`).join('|')

  useEffect(() => {
    measure()
    const list = listRef.current
    if (!list || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(list)
    return () => observer.disconnect()
  }, [signature])

  // A tab opened from a link (?tab=reviews) may start out of sight: bring it into view.
  useEffect(() => {
    const list = listRef.current
    const tab = activeItem ? tabRefs.current[activeItem.key] : null
    if (!list || !tab) return
    const over = tab.offsetLeft + tab.offsetWidth - (list.scrollLeft + list.clientWidth)
    if (over > 0) list.scrollLeft += over
    else if (tab.offsetLeft < list.scrollLeft) list.scrollLeft = tab.offsetLeft
    measure()
  }, [activeItem?.key, signature])

  // WAI-ARIA tabs pattern: only the active tab is in the Tab order (roving
  // tabindex), so the arrow keys / Home / End must move between tabs --
  // without them the inactive tabs were unreachable by keyboard.
  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let next = -1
    if (event.key === 'ArrowRight') next = (index + 1) % items.length
    else if (event.key === 'ArrowLeft') next = (index - 1 + items.length) % items.length
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = items.length - 1
    if (next < 0) return
    event.preventDefault()
    const target = items[next]
    setActive(target.key)
    tabRefs.current[target.key]?.focus()
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="relative min-w-0">
      <div
        ref={listRef}
        role="tablist"
        onScroll={measure}
        className="relative flex gap-1 overflow-x-auto border-b border-[var(--border)]"
      >
        {items.map((item, index) => {
          const isActive = item.key === activeItem?.key
          return (
            <button
              key={item.key}
              type="button"
              role="tab"
              id={`${baseId}-tab-${item.key}`}
              aria-controls={`${baseId}-panel`}
              ref={(el) => {
                tabRefs.current[item.key] = el
              }}
              onKeyDown={(e) => handleKeyDown(e, index)}
              aria-selected={isActive}
              tabIndex={isActive ? 0 : -1}
              onClick={() => setActive(item.key)}
              // Dashboard redesign Phase 3: active tab gets a small raised
              // chip (qth-raised-sm) instead of only a border-b-2, for
              // tactile consistency; inactive tabs stay flat on purpose --
              // this is a navigation strip inside otherwise-dense admin
              // pages, not a hero widget. Also added a focus-visible
              // outline -- there wasn't one before.
              className={`inline-flex h-10 shrink-0 items-center rounded-t-md border-b-2 px-3 max-md:min-h-11 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)] ${
                isActive
                  ? 'qth-raised-sm border-[var(--primary)] bg-[var(--tactile-surface-raised)] text-[var(--foreground)]'
                  : 'border-transparent text-[var(--muted-foreground)] hover:text-[var(--foreground)]'
              }`}
            >
              {item.label}
              {item.count !== undefined && <CountBadge count={item.count} />}
            </button>
          )
        })}
      </div>
        {(['left', 'right'] as const).map(
          (side) =>
            more[side] && (
              <span
                key={side}
                aria-hidden="true"
                data-testid={`tabs-more-${side}`}
                className={cn(
                  'pointer-events-none absolute inset-y-0 flex w-10 items-center text-[var(--muted-foreground)]',
                  side === 'left'
                    ? 'left-0 justify-start bg-gradient-to-r from-[var(--background)] from-40% to-transparent'
                    : 'right-0 justify-end bg-gradient-to-l from-[var(--background)] from-40% to-transparent',
                )}
              >
                {side === 'left' ? <ChevronLeft className="size-4" /> : <ChevronRight className="size-4" />}
              </span>
            ),
        )}
      </div>
      <div role="tabpanel" id={`${baseId}-panel`} aria-labelledby={`${baseId}-tab-${activeItem?.key}`}>
        {activeItem?.content}
      </div>
    </div>
  )
}

export interface LinkTabItem {
  label: string
  to: string
  end?: boolean
  count?: number
}

/**
 * Router-link variant of the tab strip (same look as the ProjectTabs /
 * ReportTabs pattern): a <nav> of NavLinks, active one gets aria-current="page".
 * Links, not role=tab, because each "tab" is a real route; Tab/Enter move
 * between them as with any link list.
 */
export function LinkTabs({ items, label, className }: { items: LinkTabItem[]; label: string; className?: string }) {
  return (
    <nav aria-label={label} className={cn('max-w-full overflow-x-auto border-b border-[var(--border)]', className)}>
      <ul className="flex min-w-max gap-1">
        {items.map((t) => (
          <li key={t.label}>
            <NavLink
              to={t.to}
              end={t.end}
              className={({ isActive }) =>
                cn(
                  'inline-flex min-h-10 items-center border-b-2 px-3 text-sm font-medium whitespace-nowrap transition-colors duration-[var(--motion-base)] motion-reduce:transition-none max-md:min-h-11',
                  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]',
                  isActive
                    ? 'border-[var(--primary)] text-[var(--foreground)]'
                    : 'border-transparent text-[var(--muted-foreground)] hover:text-[var(--foreground)]',
                )
              }
            >
              {t.label}
              {t.count !== undefined && <CountBadge count={t.count} />}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  )
}
