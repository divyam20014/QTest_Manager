import { Minus, TrendingDown, TrendingUp } from 'lucide-react'
import { Link } from 'react-router-dom'

import { fetchProjectTestStatus } from '@/api/projectDashboard'
import { fetchDashboardSummary } from '@/api/reporting'
import { EmbossedCard } from '@/components/ui/EmbossedCard'
import { Skeleton } from '@/components/ui/skeleton'
import { defectsLink, testCasesLink } from '@/lib/projectDashboard'
import { cn } from '@/lib/utils'
import { type Trend, countTrend, TREND_ARROW } from '@/routes/dashboardKpi'

import { useOverviewQuery } from './shared'

const DOT = {
  good: 'bg-[var(--status-good)]',
  serious: 'bg-[var(--status-serious)]',
  warning: 'bg-[var(--status-warning)]',
  neutral: 'bg-[var(--status-neutral)]',
} as const

const TREND_TONE = {
  good: 'text-[var(--status-good)]',
  bad: 'text-[var(--status-serious)]',
  neutral: 'text-[var(--muted-foreground)]',
} as const

interface TileSpec {
  key: string
  label: string
  value: number | undefined
  to: string
  dot?: keyof typeof DOT
  /** Only given where the API has a real previous-period figure. */
  trend?: Trend
}

function KpiTile({ spec }: { spec: TileSpec }) {
  const shown = spec.value === undefined ? '—' : String(spec.value)
  const trend = spec.trend && spec.trend.direction !== 'none' ? spec.trend : null
  const Icon = trend?.direction === 'up' ? TrendingUp : trend?.direction === 'down' ? TrendingDown : Minus
  return (
    <EmbossedCard
      className="relative min-h-[72px] border border-[var(--border)] p-3 transition-colors hover:border-[var(--ring)] motion-reduce:transition-none"
      data-testid={`kpi-${spec.key}`}
    >
      <Link
        to={spec.to}
        data-value={spec.value ?? ''}
        aria-label={`${spec.label}: ${shown}${trend ? `, ${trend.text}` : ''}`}
        className="flex items-center gap-1.5 text-xs font-medium text-[var(--muted-foreground)] after:absolute after:inset-0 after:rounded-xl focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:outline-offset-2 focus-visible:after:outline-[var(--ring)]"
      >
        {spec.dot && <span aria-hidden="true" className={cn('size-2 shrink-0 rounded-full', DOT[spec.dot])} />}
        <span className="truncate">{spec.label}</span>
      </Link>
      <p className="mt-1 text-2xl font-semibold leading-none tabular-nums" aria-hidden="true">
        {shown}
      </p>
      {trend && (
        <p className={cn('mt-1.5 flex items-center gap-1 text-[11px]', TREND_TONE[trend.tone])} aria-hidden="true">
          <Icon className="size-3" />
          <span>
            {TREND_ARROW[trend.direction]} {trend.text}
          </span>
        </p>
      )}
    </EmbossedCard>
  )
}

/** Eight compact, clickable numbers. Test case figures come from one aggregate, defect figures from
 * the dashboard summary; a figure whose request failed shows a dash rather than a made-up zero. */
export function KpiStrip({ projectId }: { projectId: string }) {
  const status = useOverviewQuery(projectId, ['test-status'], () => fetchProjectTestStatus(projectId))
  const summary = useOverviewQuery(projectId, ['summary'], () => fetchDashboardSummary(projectId))
  const s = status.data
  const d = summary.data
  const openDefects = d ? Object.values(d.defects.open_by_severity).reduce((a, b) => a + b, 0) : undefined
  const days = d?.previous?.days ?? 30
  const tiles: TileSpec[] = [
    {
      key: 'total',
      label: 'Total test cases',
      value: s?.total,
      to: testCasesLink(projectId),
      trend: s && d?.previous ? countTrend(s.total, d.previous.test_cases_total, days, true) : undefined,
    },
    { key: 'executed', label: 'Executed', value: s?.executed, to: testCasesLink(projectId, { executionStatus: 'Executed' }) },
    { key: 'passed', label: 'Passed', value: s?.passed, dot: 'good', to: testCasesLink(projectId, { executionStatus: 'Pass' }) },
    { key: 'failed', label: 'Failed', value: s?.failed, dot: 'serious', to: testCasesLink(projectId, { executionStatus: 'Fail' }) },
    { key: 'blocked', label: 'Blocked', value: s?.blocked, dot: 'warning', to: testCasesLink(projectId, { executionStatus: 'Blocked' }) },
    { key: 'not-run', label: 'Not run', value: s?.not_run, dot: 'neutral', to: testCasesLink(projectId, { executionStatus: 'Not Run' }) },
    {
      key: 'open-defects',
      label: 'Open defects',
      value: openDefects,
      to: defectsLink(projectId, { open: true }),
      trend:
        openDefects !== undefined && d?.previous ? countTrend(openDefects, d.previous.open_defects, days, false) : undefined,
    },
    {
      key: 'critical-defects',
      label: 'Critical defects',
      value: d?.defects.critical_count,
      to: defectsLink(projectId, { open: true, severity: 'Critical' }),
    },
  ]
  const loading = (status.isPending && !status.isError) || (summary.isPending && !summary.isError)
  return (
    <section aria-label="Key numbers" data-testid="kpi-strip" aria-busy={loading}>
      {(status.isError || summary.isError) && (
        <p role="status" className="mb-2 text-xs text-[var(--muted-foreground)]">
          Some numbers could not load ({status.isError ? 'test cases' : 'defects'}). They show a dash until they do.{' '}
          <button
            type="button"
            className="font-medium underline"
            onClick={() => {
              void status.refetch()
              void summary.refetch()
            }}
          >
            Retry
          </button>
        </p>
      )}
      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-8">
        {tiles.map((t) => (
          <li key={t.key} className="min-w-0">
            {loading && t.value === undefined ? (
              <EmbossedCard className="min-h-[72px] p-3">
                <Skeleton className="h-3 w-16" />
                <Skeleton className="mt-3 h-6 w-10" />
              </EmbossedCard>
            ) : (
              <KpiTile spec={t} />
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}
