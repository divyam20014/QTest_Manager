import { AlarmClock, ChevronLeft, ChevronRight, Play, Rocket } from 'lucide-react'
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { Link } from 'react-router-dom'

import { addDays, dayLabel, monthGrid, monthLabel, monthOf, shiftMonth, WEEKDAYS } from '@/lib/calendarGrid'
import { Badge, type BadgeTone } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useIsMobile } from '@/lib/useMediaQuery'
import { cn } from '@/lib/utils'

// ADR-124. A month calendar of dated records. Presentational: the page fetches the range (api/calendar)
// and turns it into events. Desktop shows a month grid (a roving-focus grid: arrow keys move by day and
// week, PageUp / PageDown by month, Home / End to the week's ends); a phone shows the same month as an
// agenda list, because a 7-column grid is unreadable at 375px. Every event is a link to its record.

export type CalendarEventKind = 'run' | 'due' | 'release'

export interface CalendarEvent {
  id: string
  /** YYYY-MM-DD */
  date: string
  kind: CalendarEventKind
  label: string
  /** Muted second line (project, status). */
  detail?: string
  href: string
  tone: BadgeTone
}

const KIND_ICON = { run: Play, due: AlarmClock, release: Rocket } as const
const KIND_LABEL: Record<CalendarEventKind, string> = { run: 'Test run', due: 'Cases due', release: 'Release' }

function EventLink({ event, tabIndex, compact }: { event: CalendarEvent; tabIndex?: number; compact?: boolean }) {
  const Icon = KIND_ICON[event.kind]
  return (
    <Link
      to={event.href}
      tabIndex={tabIndex}
      title={`${KIND_LABEL[event.kind]}: ${event.label}${event.detail ? ` (${event.detail})` : ''}`}
      aria-label={`${KIND_LABEL[event.kind]}: ${event.label}`}
      className="block min-w-0 rounded-md focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--ring)]"
    >
      <Badge tone={event.tone} className={cn('w-full min-w-0 gap-1 rounded-md', compact ? 'px-1.5 py-0.5' : 'px-2 py-1 text-sm')}>
        <Icon className="size-3 shrink-0" aria-hidden="true" />
        <span className="truncate">{event.label}</span>
      </Badge>
    </Link>
  )
}

export function CalendarView({
  label,
  month,
  onMonthChange,
  today,
  events,
  loading,
  error,
  onRetry,
  truncated,
  toolbar,
}: {
  label: string
  /** YYYY-MM */
  month: string
  onMonthChange: (month: string) => void
  /** YYYY-MM-DD, the UTC today of ADR-123. */
  today: string
  events: CalendarEvent[]
  loading: boolean
  error?: boolean
  onRetry?: () => void
  truncated?: boolean
  /** Extra controls beside the month navigation (filters). */
  toolbar?: React.ReactNode
}) {
  const uid = useId()
  const isMobile = useIsMobile()
  const grid = useMemo(() => monthGrid(month), [month])
  const byDay = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>()
    for (const e of events) map.set(e.date, [...(map.get(e.date) ?? []), e])
    return map
  }, [events])
  const initialDay = monthOf(today) === month ? today : `${month}-01`
  const [active, setActive] = useState(initialDay)
  const [prevMonth, setPrevMonth] = useState(month)
  if (prevMonth !== month) {
    setPrevMonth(month)
    if (monthOf(active) !== month) setActive(initialDay)
  }
  const wantFocus = useRef(false)
  useEffect(() => {
    if (wantFocus.current) {
      wantFocus.current = false
      document.getElementById(`${uid}-d-${active}`)?.focus()
    }
  }, [active, uid, month])

  function move(next: string) {
    wantFocus.current = true
    setActive(next)
    if (monthOf(next) !== month) onMonthChange(monthOf(next))
  }
  function onKey(e: KeyboardEvent<HTMLButtonElement>) {
    const weekday = (new Date(`${active}T00:00:00Z`).getUTCDay() + 6) % 7
    const keys: Record<string, string> = {
      ArrowLeft: addDays(active, -1),
      ArrowRight: addDays(active, 1),
      ArrowUp: addDays(active, -7),
      ArrowDown: addDays(active, 7),
      Home: addDays(active, -weekday),
      End: addDays(active, 6 - weekday),
      PageUp: addDays(shiftMonth(monthOf(active), -1) + '-01', Math.min(Number(active.slice(8)) - 1, 27)),
      PageDown: addDays(shiftMonth(monthOf(active), 1) + '-01', Math.min(Number(active.slice(8)) - 1, 27)),
    }
    if (keys[e.key]) {
      e.preventDefault()
      move(keys[e.key])
    }
  }

  const monthEvents = events.filter((e) => monthOf(e.date) === month)
  const days = [...new Set(monthEvents.map((e) => e.date))].sort()
  const selected = byDay.get(active) ?? []

  return (
    <section aria-label={label} className="flex flex-col gap-3" data-testid="calendar">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
          <Button variant="outline" size="sm" aria-label="Previous month" className="max-md:min-h-11 max-md:min-w-11" onClick={() => onMonthChange(shiftMonth(month, -1))}>
            <ChevronLeft className="size-4" aria-hidden="true" />
          </Button>
          <Button variant="outline" size="sm" aria-label="Next month" className="max-md:min-h-11 max-md:min-w-11" onClick={() => onMonthChange(shiftMonth(month, 1))}>
            <ChevronRight className="size-4" aria-hidden="true" />
          </Button>
          <Button variant="outline" size="sm" className="max-md:min-h-11" onClick={() => { setActive(today); onMonthChange(monthOf(today)) }}>
            Today
          </Button>
        </div>
        <h2 className="text-base font-semibold" aria-live="polite" data-testid="calendar-month">
          {monthLabel(month)}
        </h2>
        {toolbar && <div className="ml-auto flex items-center gap-3">{toolbar}</div>}
      </div>

      <ul className="flex flex-wrap gap-3 text-xs text-[var(--muted-foreground)]" aria-label="Legend">
        {(Object.keys(KIND_ICON) as CalendarEventKind[]).map((k) => {
          const Icon = KIND_ICON[k]
          return (
            <li key={k} className="inline-flex items-center gap-1">
              <Icon className="size-3.5" aria-hidden="true" />
              {k === 'run' ? 'Run started or finished' : k === 'due' ? 'Run cases due (red: overdue)' : 'Release date'}
            </li>
          )
        })}
      </ul>

      {error ? (
        <div className="flex flex-col items-start gap-2 rounded-md border border-[var(--border)] p-4 text-sm">
          <p className="text-[var(--status-serious)]">Could not load the calendar.</p>
          {onRetry && (
            <Button size="sm" variant="outline" onClick={onRetry}>
              Try again
            </Button>
          )}
        </div>
      ) : loading ? (
        <div aria-busy="true" className="flex flex-col gap-2">
          <Skeleton className="h-8" />
          <Skeleton className="h-64" />
        </div>
      ) : isMobile ? (
        <div className="flex flex-col gap-3">
          {days.length === 0 ? (
            <p className="rounded-md border border-dashed border-[var(--border)] px-3 py-8 text-center text-sm text-[var(--muted-foreground)]">
              Nothing is scheduled in {monthLabel(month)}.
            </p>
          ) : (
            days.map((d) => (
              <section key={d} aria-label={dayLabel(d)} className="flex flex-col gap-1.5">
                <h3 className="text-sm font-semibold">
                  {dayLabel(d)}
                  {d === today ? ' (today)' : ''}
                </h3>
                <ul className="flex flex-col gap-1.5">
                  {(byDay.get(d) ?? []).map((e) => (
                    <li key={e.id} className="min-h-11">
                      <EventLink event={e} />
                      {e.detail && <p className="px-1 pt-0.5 text-xs text-[var(--muted-foreground)]">{e.detail}</p>}
                    </li>
                  ))}
                </ul>
              </section>
            ))
          )}
        </div>
      ) : (
        <>
          <div role="grid" aria-label={`${label}, ${monthLabel(month)}`} className="overflow-hidden rounded-lg border border-[var(--border)]">
            <div role="row" className="grid grid-cols-7 border-b border-[var(--border)] bg-[var(--muted)]">
              {WEEKDAYS.map((w) => (
                <div key={w} role="columnheader" className="px-2 py-1.5 text-xs font-medium text-[var(--muted-foreground)]">
                  {w}
                </div>
              ))}
            </div>
            {Array.from({ length: 6 }, (_, week) => (
              <div key={week} role="row" className="grid grid-cols-7">
                {grid.slice(week * 7, week * 7 + 7).map((d) => {
                  const items = byDay.get(d) ?? []
                  const inMonth = monthOf(d) === month
                  const isActive = d === active
                  return (
                    <div
                      key={d}
                      role="gridcell"
                      aria-selected={isActive}
                      className={cn(
                        'flex min-h-24 min-w-0 flex-col gap-1 border-b border-r border-[var(--border)] p-1 last:border-r-0',
                        !inMonth && 'bg-[var(--muted)]/50 text-[var(--muted-foreground)]',
                        isActive && 'ring-2 ring-inset ring-[var(--ring)]',
                      )}
                    >
                      <button
                        type="button"
                        id={`${uid}-d-${d}`}
                        tabIndex={isActive ? 0 : -1}
                        aria-label={`${dayLabel(d)}${d === today ? ', today' : ''}, ${items.length === 0 ? 'nothing scheduled' : `${items.length} item${items.length === 1 ? '' : 's'}`}`}
                        onClick={() => setActive(d)}
                        onKeyDown={onKey}
                        className={cn(
                          'inline-flex size-6 items-center justify-center self-start rounded-full text-xs font-medium focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--ring)]',
                          d === today && 'bg-[var(--primary)] text-[var(--primary-foreground)]',
                        )}
                      >
                        {Number(d.slice(8))}
                      </button>
                      {items.slice(0, 2).map((e) => (
                        <EventLink key={e.id} event={e} tabIndex={isActive ? 0 : -1} compact />
                      ))}
                      {items.length > 2 && (
                        <button
                          type="button"
                          tabIndex={-1}
                          onClick={() => setActive(d)}
                          className="self-start rounded px-1 text-xs font-medium text-[var(--foreground)] underline underline-offset-2"
                        >
                          +{items.length - 2} more
                        </button>
                      )}
                    </div>
                  )
                })}
              </div>
            ))}
          </div>
          <section aria-label={`Agenda for ${dayLabel(active)}`} className="flex flex-col gap-1.5 rounded-lg border border-[var(--border)] p-3">
            <h3 className="text-sm font-semibold">{dayLabel(active)}</h3>
            {selected.length === 0 ? (
              <p className="text-sm text-[var(--muted-foreground)]">Nothing scheduled.</p>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {selected.map((e) => (
                  <li key={e.id} className="flex flex-col gap-0.5">
                    <EventLink event={e} />
                    {e.detail && <p className="px-1 text-xs text-[var(--muted-foreground)]">{e.detail}</p>}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
      {truncated && (
        <p className="text-xs text-[var(--muted-foreground)]" role="note">
          This range holds more items than are shown. Filter by project to see them all.
        </p>
      )}
      {!loading && !error && monthEvents.length === 0 && !isMobile && (
        <p className="text-xs text-[var(--muted-foreground)]">Nothing is scheduled in {monthLabel(month)}.</p>
      )}
    </section>
  )
}
