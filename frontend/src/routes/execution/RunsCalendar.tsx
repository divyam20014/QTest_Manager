import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'

import { getCalendar } from '@/api/calendar'
import { CalendarView, type CalendarEvent } from '@/components/list/CalendarView'
import { gridRange, monthOf, parseMonth } from '@/lib/calendarGrid'
import { todayIso } from '@/lib/dueDate'
import { projectReleasesPath } from '@/lib/projectNav'
import { RUN_STATUS_LABEL } from './runStatus'

/**
 * Test runs on a month calendar (ADR-124): runs by the day they started and the day they finished, run
 * cases by due date (one entry per day and run, red when overdue) and releases by release date. The
 * month and the "Overdue only" switch live in the URL (`?month=2026-11&overdue=true`), so a calendar
 * is shareable and a saved view can hold the switch. Data is one date-range request per month.
 */
export function RunsCalendar({ projectId }: { projectId?: string }) {
  const [params, setParams] = useSearchParams()
  const today = todayIso()
  const month = parseMonth(params.get('month')) ?? monthOf(today)
  const overdueOnly = params.get('overdue') === 'true'
  const range = gridRange(month)

  const query = useQuery({
    queryKey: ['calendar', projectId ?? '', range.from, range.to],
    queryFn: () => getCalendar({ ...range, project_id: projectId }),
  })

  function patch(next: Record<string, string>) {
    setParams(
      (prev) => {
        const p = new URLSearchParams(prev)
        for (const [k, v] of Object.entries(next)) {
          if (v) p.set(k, v)
          else p.delete(k)
        }
        return p
      },
      { replace: true },
    )
  }

  const events = useMemo<CalendarEvent[]>(() => {
    const data = query.data
    if (!data) return []
    const out: CalendarEvent[] = []
    for (const d of data.due) {
      if (overdueOnly && !d.overdue) continue
      out.push({
        id: `due-${d.run_id}-${d.due_date}`,
        date: d.due_date,
        kind: 'due',
        label: `${d.open_cases} due: ${d.run_name}`,
        detail: `${d.project_name} · ${d.open_cases} of ${d.total_cases} case${d.total_cases === 1 ? '' : 's'} not executed${d.overdue ? ' (overdue)' : ''}`,
        href: `/test-runs/${d.run_id}`,
        tone: d.overdue ? 'critical' : 'info',
      })
    }
    if (!overdueOnly) {
      for (const r of data.runs) {
        const tone = r.status === 'in_progress' ? 'positive' : r.status === 'paused' ? 'warning' : 'neutral'
        out.push({
          id: `run-${r.id}-start`,
          date: r.start_date,
          kind: 'run',
          label: `Started: ${r.name}`,
          detail: `${r.project_name} · ${r.run_type} · ${RUN_STATUS_LABEL[r.status]}`,
          href: `/test-runs/${r.id}`,
          tone,
        })
        if (r.end_date && r.end_date !== r.start_date) {
          out.push({
            id: `run-${r.id}-end`,
            date: r.end_date,
            kind: 'run',
            label: `Finished: ${r.name}`,
            detail: `${r.project_name} · ${r.run_type}`,
            href: `/test-runs/${r.id}`,
            tone: 'neutral',
          })
        }
      }
      for (const r of data.releases) {
        out.push({
          id: `release-${r.id}`,
          date: r.release_date,
          kind: 'release',
          label: r.name,
          detail: `${r.project_name}${r.status ? ` · ${r.status}` : ''}`,
          href: projectReleasesPath(r.project_id),
          tone: 'info',
        })
      }
    }
    return out
  }, [query.data, overdueOnly])

  return (
    <CalendarView
      label="Test run calendar"
      month={month}
      onMonthChange={(m) => patch({ month: m === monthOf(today) ? '' : m })}
      today={today}
      events={events}
      loading={query.isLoading}
      error={query.isError}
      onRetry={() => void query.refetch()}
      truncated={query.data?.truncated}
      toolbar={
        <label className="inline-flex items-center gap-2 text-sm max-md:min-h-11">
          <input type="checkbox" checked={overdueOnly} onChange={(e) => patch({ overdue: e.target.checked ? 'true' : '' })} />
          Overdue only
        </label>
      }
    />
  )
}
