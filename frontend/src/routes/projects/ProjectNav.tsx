import { MoreHorizontal } from 'lucide-react'
import { useLayoutEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'

import { DropdownMenu } from '@/components/ui/dropdown-menu'
import { type ProjectTabKey, type ResolvedTab } from '@/lib/projectNav'
import { cn } from '@/lib/utils'

export interface ProjectNavCount {
  /** Shown as a small number after the label; hidden from assistive tech so the link's name stays the label. */
  value: number
}

const MORE_WIDTH = 84

const tabClass = (active: boolean) =>
  cn(
    'inline-flex min-h-10 items-center gap-1.5 border-b-2 px-2.5 text-sm font-medium whitespace-nowrap transition-colors duration-[var(--motion-base)] motion-reduce:transition-none max-md:min-h-11',
    'focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--ring)]',
    active
      ? 'border-[var(--primary)] text-[var(--foreground)]'
      : 'border-transparent text-[var(--muted-foreground)] hover:text-[var(--foreground)]',
  )

/**
 * The project tab strip (ADR-122), replacing ProjectTabs. Links with aria-current="page" on the
 * active tab. Tabs that do not fit move into a "More" menu (the active tab always stays in the
 * strip), so neither the strip nor the page ever scrolls sideways. Order and visibility come in
 * already resolved (lib/projectNav.ts).
 */
export function ProjectNav({
  tabs,
  activeKey,
  counts = {},
}: {
  tabs: ResolvedTab[]
  activeKey: ProjectTabKey | null
  counts?: Partial<Record<ProjectTabKey, ProjectNavCount>>
}) {
  const navigate = useNavigate()
  const containerRef = useRef<HTMLDivElement>(null)
  const measureRef = useRef<HTMLUListElement>(null)
  const [fit, setFit] = useState(tabs.length)

  const signature = tabs.map((t) => t.key).join('|') + JSON.stringify(counts)

  // Measure every tab in an invisible copy of the strip and keep as many as fit the container.
  useLayoutEffect(() => {
    const container = containerRef.current
    const measure = measureRef.current
    if (!container || !measure) return
    function recompute() {
      const available = container!.clientWidth
      const widths = Array.from(measure!.children).map((li) => (li as HTMLElement).offsetWidth)
      if (available === 0 || widths.every((w) => w === 0)) {
        setFit(tabs.length)
        return
      }
      const total = widths.reduce((a, b) => a + b + 2, 0)
      if (total <= available) {
        setFit(tabs.length)
        return
      }
      let used = MORE_WIDTH
      let count = 0
      for (const w of widths) {
        if (used + w > available) break
        used += w + 2
        count += 1
      }
      setFit(Math.max(1, count))
    }
    recompute()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(recompute)
    observer.observe(container)
    return () => observer.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature])

  let visible = tabs.slice(0, fit)
  const activeIndex = tabs.findIndex((t) => t.key === activeKey)
  if (activeIndex >= fit && fit > 0) {
    // Keep the current tab in the strip: it takes the last visible slot.
    visible = [...tabs.slice(0, fit - 1), tabs[activeIndex]]
  }
  const overflow = tabs.filter((t) => !visible.includes(t))

  const label = (t: ResolvedTab) => (
    <>
      {t.label}
      {counts[t.key] && (
        <span
          aria-hidden="true"
          className="rounded-full bg-[var(--muted)] px-1.5 text-xs font-normal text-[var(--muted-foreground)] tabular-nums"
        >
          {counts[t.key]!.value}
        </span>
      )}
    </>
  )

  return (
    <div ref={containerRef} className="relative border-b border-[var(--border)]">
      <nav aria-label="Project sections">
        <ul className="flex items-stretch gap-0.5">
          {visible.map((t) => (
            <li key={t.key}>
              <Link
                to={t.to}
                aria-current={t.key === activeKey ? 'page' : undefined}
                data-testid={`project-tab-${t.key}`}
                className={tabClass(t.key === activeKey)}
              >
                {label(t)}
              </Link>
            </li>
          ))}
          {overflow.length > 0 && (
            <li>
              <DropdownMenu
                label="More project sections"
                align="end"
                items={overflow.map((t) => ({ label: t.label, onSelect: () => navigate(t.to) }))}
                trigger={(props) => (
                  <button
                    {...props}
                    type="button"
                    data-testid="project-tabs-more"
                    className={cn(tabClass(false), 'gap-1')}
                  >
                    More
                    <MoreHorizontal aria-hidden="true" className="size-4" />
                  </button>
                )}
              />
            </li>
          )}
        </ul>
      </nav>
      {/* Invisible copy used only to measure each tab's width. */}
      <ul
        ref={measureRef}
        aria-hidden="true"
        inert
        className="pointer-events-none invisible absolute left-0 top-0 flex h-0 gap-0.5 overflow-hidden"
      >
        {tabs.map((t) => (
          <li key={t.key} className="shrink-0">
            <span className={tabClass(false)}>{label(t)}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
