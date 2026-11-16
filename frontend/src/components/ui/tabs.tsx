import { type KeyboardEvent, type ReactNode, useId, useRef, useState } from 'react'

export interface TabItem {
  key: string
  label: string
  content: ReactNode
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
      <div role="tablist" className="flex gap-1 overflow-x-auto border-b border-[var(--border)]">
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
            </button>
          )
        })}
      </div>
      <div role="tabpanel" id={`${baseId}-panel`} aria-labelledby={`${baseId}-tab-${activeItem?.key}`}>
        {activeItem?.content}
      </div>
    </div>
  )
}
