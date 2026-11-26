import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import { Suspense, lazy, type ReactNode } from 'react'

import type { DashboardWidget } from '@/api/dashboards'
import { fetchMyAssignedCases } from '@/api/dashboards'
import { getDefectStatusCounts } from '@/api/defects'
import { runSavedReport } from '@/api/reportBuilder'
import {
  fetchActivityStream,
  fetchAggregateReport,
  fetchDashboardSummary,
  fetchDefectAgingSummary,
  fetchDefectLeakage,
  fetchExecutionTrend,
  fetchFlakyTests,
  fetchReleaseReadiness,
} from '@/api/reporting'
import { useAuth } from '@/lib/auth'
import { ResponsiveTable, type ResponsiveColumn } from '@/components/table/ResponsiveTable'
import { Button } from '@/components/ui/button'
import { CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ChartLegend, ChartPanel, type ChartTable } from '@/components/ui/ChartPanel'
import { EmbossedCard } from '@/components/ui/EmbossedCard'
import { ChartSkeleton, Skeleton } from '@/components/ui/skeleton'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { levelTone } from '@/lib/statusTones'
import { usePrefersReducedMotion } from '@/lib/useMediaQuery'
import { useThemePreference } from '@/lib/useThemePreference'
import { categoricalColor } from '@/routes/reporting/palette'

import { WIDGET_BY_TYPE } from './widgetCatalogue'

const TrendLineChart = lazy(() => import('@/routes/dashboardCharts').then((m) => ({ default: m.TrendLineChart })))

const SEVERITY_ORDER = ['Critical', 'High', 'Medium', 'Low']

function sevRank(s: string): number {
  const i = SEVERITY_ORDER.indexOf(s)
  return i === -1 ? 99 : i
}

/** Per-user cache key: a widget's data depends on who is looking (visibility). */
function useWidgetQuery<T>(key: unknown[], fn: () => Promise<T>, enabled: boolean): UseQueryResult<T> {
  const userId = useAuth().user?.user_id ?? 'anon'
  return useQuery({ queryKey: ['dashboards', 'widget', userId, ...key], queryFn: fn, retry: 1, enabled })
}

function Note({ children }: { children: ReactNode }) {
  return <p className="px-1 py-6 text-center text-sm text-[var(--muted-foreground)]">{children}</p>
}

/** Inline error: the rest of the page keeps working. */
function WidgetError({ q }: { q: UseQueryResult<unknown> }) {
  return (
    <div role="alert" className="flex flex-col items-center gap-2 px-1 py-4 text-center">
      <p className="text-sm font-medium text-[var(--status-serious)]">This widget could not load</p>
      <Button type="button" variant="outline" size="sm" onClick={() => void q.refetch()}>
        Retry
      </Button>
    </div>
  )
}

/** Loading / error / content for one query. */
function Async<T>({
  q,
  chart,
  children,
}: {
  q: UseQueryResult<T>
  chart?: boolean
  children: (data: T) => ReactNode
}) {
  if (q.isError) return <WidgetError q={q} />
  if (q.isPending || q.data === undefined) {
    return chart ? <ChartSkeleton /> : <Skeleton className="h-20 w-full" />
  }
  return <>{children(q.data)}</>
}

function Shell({ title, children }: { title: string; children: ReactNode }) {
  return (
    <EmbossedCard className="h-full">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </EmbossedCard>
  )
}

interface Bar {
  label: string
  value: number
  color: string
}

function BarList({ bars, unit }: { bars: Bar[]; unit: string }) {
  const max = Math.max(1, ...bars.map((b) => b.value))
  return (
    <ul className="flex flex-col gap-2" aria-label={`${unit} by category`}>
      {bars.map((b) => (
        <li key={b.label} className="grid grid-cols-[6rem_1fr_3rem] items-center gap-2 text-xs">
          <span className="truncate">{b.label}</span>
          <span className="h-2.5 rounded-full bg-[var(--muted)]" aria-hidden="true">
            <span
              className="block h-full rounded-full"
              style={{ width: `${(b.value / max) * 100}%`, background: b.color }}
            />
          </span>
          <span className="text-right font-medium tabular-nums">{b.value}</span>
        </li>
      ))}
    </ul>
  )
}

function BarChartWidget({
  title,
  bars,
  unit,
  columns,
  rows,
  empty,
}: {
  title: string
  bars: Bar[]
  unit: string
  columns: string[]
  rows: (string | number)[][]
  empty: string
}) {
  const table: ChartTable | undefined = bars.length > 0 ? { columns, rows } : undefined
  return (
    <ChartPanel
      title={title}
      bodyClassName="min-h-32"
      summary={bars.length ? `${title}: ${bars.map((b) => `${b.value} ${b.label}`).join(', ')}.` : undefined}
      table={table}
    >
      {bars.length ? <BarList bars={bars} unit={unit} /> : <Note>{empty}</Note>}
    </ChartPanel>
  )
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-[var(--muted)] p-3">
      <p className="text-xs text-[var(--muted-foreground)]">{label}</p>
      <p className="text-xl font-semibold tabular-nums">{value}</p>
    </div>
  )
}

const pct = (n: number | null | undefined) => (n == null ? 'n/a' : `${Math.round(n * 10) / 10}%`)

type P = { pid?: string; settings: DashboardWidget['settings'] }

function KpiSummary({ pid }: P) {
  const q = useWidgetQuery(['summary', pid], () => fetchDashboardSummary(pid), true)
  return (
    <Shell title="Summary">
      <Async q={q}>
        {(s) => (
          <div className="grid grid-cols-2 gap-2">
            <Tile label="Active projects" value={String(s.projects.active)} />
            <Tile label="Approved test cases" value={`${s.test_cases.approved_count} of ${s.test_cases.total}`} />
            <Tile label="Step pass rate" value={pct(s.test_runs.step_pass_percentage)} />
            <Tile label="Critical defects" value={String(s.defects.critical_count)} />
          </div>
        )}
      </Async>
    </Shell>
  )
}

function ExecutionTrend({ pid, settings }: P) {
  const days = Number(settings.days ?? 30)
  const [theme] = useThemePreference()
  const dark = theme === 'dark'
  const reduceMotion = usePrefersReducedMotion()
  const q = useWidgetQuery(['trend', days, pid], () => fetchExecutionTrend(days, pid), true)
  const points = q.data?.points ?? []
  const pass = points.reduce((n, p) => n + p.pass_count, 0)
  const fail = points.reduce((n, p) => n + p.fail_count, 0)
  const passColor = categoricalColor(2, dark)
  const failColor = categoricalColor(7, dark)
  return (
    <ChartPanel
      title={`Execution trend (${days} days)`}
      summary={points.length ? `Line chart, last ${days} days: ${pass} passes and ${fail} failures.` : undefined}
      table={
        points.length
          ? {
              columns: ['Date', 'Pass', 'Fail'],
              rows: points.map((p) => [p.date, p.pass_count, p.fail_count]),
            }
          : undefined
      }
      bodyClassName="h-48"
    >
      <Async q={q} chart>
        {() =>
          points.length ? (
            <div className="flex h-full flex-col">
              <div className="min-h-0 flex-1">
                <Suspense fallback={<ChartSkeleton />}>
                  <TrendLineChart points={points} passColor={passColor} failColor={failColor} reduceMotion={reduceMotion} />
                </Suspense>
              </div>
              <ChartLegend
                items={[
                  { label: 'Pass', color: passColor, value: String(pass) },
                  { label: 'Fail', color: failColor, value: String(fail) },
                ]}
              />
            </div>
          ) : (
            <Note>No executions in this period.</Note>
          )
        }
      </Async>
    </ChartPanel>
  )
}

function StatusDistribution({ pid }: P) {
  const [theme] = useThemePreference()
  const q = useWidgetQuery(
    ['status', pid],
    () => fetchAggregateReport('test_case_status', 'project', { projectId: pid }),
    true,
  )
  const totals = new Map<string, number>()
  for (const r of q.data?.rows ?? []) totals.set(r.value, (totals.get(r.value) ?? 0) + r.count)
  const bars = [...totals.entries()].map(([label, value], i) => ({
    label,
    value,
    color: categoricalColor(i, theme === 'dark'),
  }))
  return q.isPending || q.isError ? (
    <Shell title="Test case status">
      <Async q={q} chart>
        {() => null}
      </Async>
    </Shell>
  ) : (
    <BarChartWidget
      title="Test case status"
      bars={bars}
      unit="Test cases"
      columns={['Status', 'Test cases']}
      rows={bars.map((b) => [b.label, b.value])}
      empty="No test cases yet."
    />
  )
}

function DefectAging({ pid }: P) {
  const [theme] = useThemePreference()
  const q = useWidgetQuery(['aging', pid], () => fetchDefectAgingSummary(pid), true)
  if (q.isPending || q.isError) {
    return (
      <Shell title="Defect aging">
        <Async q={q} chart>
          {() => null}
        </Async>
      </Shell>
    )
  }
  const buckets = [...(q.data?.buckets ?? [])].sort((a, b) => sevRank(a.severity) - sevRank(b.severity))
  const bars = buckets.map((b, i) => ({
    label: b.severity,
    value: b.open_count,
    color: categoricalColor(i, theme === 'dark'),
  }))
  return (
    <BarChartWidget
      title="Defect aging"
      bars={bars}
      unit="Open defects"
      columns={['Severity', 'Open', 'SLA breached']}
      rows={buckets.map((b) => [b.severity, b.open_count, b.breached_count])}
      empty="No open defects."
    />
  )
}

function OpenDefects({ pid }: P) {
  const [theme] = useThemePreference()
  const summary = useWidgetQuery(['defect-sev', pid], () => fetchDashboardSummary(pid), true)
  const counts = useWidgetQuery(['defect-status', pid], () => getDefectStatusCounts({ project_id: pid }), true)
  const err = summary.isError ? summary : counts.isError ? counts : null
  if (err) {
    return (
      <Shell title="Open defects by severity">
        <WidgetError q={err} />
      </Shell>
    )
  }
  if (!summary.data || !counts.data) {
    return (
      <Shell title="Open defects by severity">
        <ChartSkeleton />
      </Shell>
    )
  }
  const sev = Object.entries(summary.data.defects.open_by_severity).sort(([a], [b]) => sevRank(a) - sevRank(b))
  const bars = sev.map(([label, value], i) => ({ label, value, color: categoricalColor(i, theme === 'dark') }))
  const statuses = Object.entries(counts.data.counts)
  return (
    <ChartPanel
      title="Open defects by severity"
      bodyClassName="min-h-32"
      summary={`Open defects by severity: ${sev.map(([s, n]) => `${n} ${s}`).join(', ') || 'none'}.`}
      table={{
        columns: ['Group', 'Count'],
        rows: [...sev.map(([s, n]) => [`Severity: ${s}`, n]), ...statuses.map(([s, n]) => [`Status: ${s}`, n])],
      }}
    >
      {bars.length ? <BarList bars={bars} unit="Open defects" /> : <Note>No open defects.</Note>}
    </ChartPanel>
  )
}

function ReleaseReadiness({ pid, settings }: P) {
  const releaseId = settings.release_id ? String(settings.release_id) : undefined
  const q = useWidgetQuery(['readiness', pid, releaseId], () => fetchReleaseReadiness(pid ?? '', releaseId), !!pid)
  return (
    <Shell title="Release readiness">
      <Async q={q}>
        {(r) => (
          <div className="flex flex-col gap-2">
            <p className="text-sm font-medium">{r.release_name ?? 'Whole project'}</p>
            <div className="grid grid-cols-2 gap-2">
              <Tile label="Execution complete" value={pct(r.execution_completion_percentage)} />
              <Tile label="Run case pass rate" value={pct(r.pass_percentage)} />
              <Tile label="Requirement coverage" value={pct(r.requirement_coverage_percentage)} />
              <Tile
                label="Open defects"
                value={String(Object.values(r.open_defects_by_severity).reduce((a, b) => a + b, 0))}
              />
            </div>
            {!!r.quarantined_count && (
              <p className="text-xs text-[var(--muted-foreground)]">{r.quarantined_count} quarantined, not counted as passing.</p>
            )}
          </div>
        )}
      </Async>
    </Shell>
  )
}

function DefectLeakage({ pid }: P) {
  const q = useWidgetQuery(['leakage', pid], () => fetchDefectLeakage(pid), true)
  return (
    <Shell title="Defect leakage">
      <Async q={q}>
        {(r) => (
          <div className="grid grid-cols-2 gap-2">
            <Tile label="Leakage" value={pct(r.leakage_percentage)} />
            <Tile label="Detection effectiveness" value={pct(r.detection_effectiveness_percentage)} />
            <Tile label="Escaped defects" value={`${r.escaped_defects} of ${r.total_defects}`} />
            <Tile label="Open escaped" value={String(r.open_escaped_defects)} />
          </div>
        )}
      </Async>
    </Shell>
  )
}

function FlakyTests({ pid, settings }: P) {
  const top = Number(settings.top_n ?? 10)
  const q = useWidgetQuery(['flaky', pid, top], () => fetchFlakyTests(pid ?? '', top), !!pid)
  return (
    <Shell title={`Flaky tests (top ${top})`}>
      <Async q={q}>
        {(r) =>
          r.tests.length ? (
            <ol className="flex flex-col gap-1.5 text-sm">
              {r.tests.slice(0, top).map((t) => (
                <li key={t.test_case_id} className="flex items-center justify-between gap-2">
                  <span className="min-w-0 break-words">{t.test_case_title}</span>
                  <span className="shrink-0 text-xs tabular-nums text-[var(--muted-foreground)]">
                    {Math.round(t.flip_rate * 100)}% flips
                  </span>
                </li>
              ))}
            </ol>
          ) : (
            <Note>No flaky tests found.</Note>
          )
        }
      </Async>
    </Shell>
  )
}

function RecentActivity({ pid }: P) {
  const q = useWidgetQuery(['activity', pid], () => fetchActivityStream(pid), true)
  return (
    <Shell title="Recent activity">
      <Async q={q}>
        {(entries) =>
          entries.length ? (
            <ul className="flex flex-col gap-1.5 text-sm">
              {entries.slice(0, 8).map((e, i) => (
                <li key={`${e.entity_id}-${i}`} className="flex flex-col">
                  <span className="break-words">
                    {e.user_name ?? 'Someone'} {e.action.replace(/[._]/g, ' ')} ({e.entity_type})
                  </span>
                  <span className="text-xs text-[var(--muted-foreground)]">
                    {new Date(e.created_at).toLocaleString()}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <Note>No recent activity.</Note>
          )
        }
      </Async>
    </Shell>
  )
}

interface Row {
  [key: string]: string | number | boolean | null
}

function SavedReportWidget({ settings }: P) {
  const id = String(settings.report_id ?? '')
  const q = useWidgetQuery(['saved-report', id], () => runSavedReport(id, 1, 10), !!id)
  return (
    <Shell title="Saved report">
      <Async q={q}>
        {(r) => {
          const columns: ResponsiveColumn<Row>[] = r.columns.map((c, i) => ({
            key: c.key,
            header: c.label,
            card: i === 0 ? 'title' : 'meta',
            cell: (row) => String(row[c.key] ?? ''),
          }))
          return r.rows.length ? (
            <>
              <ResponsiveTable<Row>
                rows={r.rows.slice(0, 10)}
                rowKey={(row) => JSON.stringify(row)}
                columns={columns}
                label="Saved report rows"
              />
              {r.total > 10 && (
                <p className="mt-2 text-xs text-[var(--muted-foreground)]">Showing 10 of {r.total} rows.</p>
              )}
            </>
          ) : (
            <Note>This report returned no rows.</Note>
          )
        }}
      </Async>
    </Shell>
  )
}

function MyAssignedCases({ pid }: P) {
  const userId = useAuth().user?.user_id ?? ''
  const q = useWidgetQuery(['my-cases', pid], () => fetchMyAssignedCases(userId, pid), !!userId)
  return (
    <Shell title="My assigned test cases">
      <Async q={q}>
        {(r) =>
          r.items.length ? (
            <ul className="flex flex-col gap-1.5 text-sm">
              {r.items.slice(0, 10).map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-2">
                  <span className="min-w-0 break-words">{c.title}</span>
                  <StatusBadge tone={levelTone(c.priority)}>{c.priority}</StatusBadge>
                </li>
              ))}
            </ul>
          ) : (
            <Note>Nothing is assigned to you.</Note>
          )
        }
      </Async>
    </Shell>
  )
}

const RENDERERS: Record<DashboardWidget['widget_type'], (p: P) => ReactNode> = {
  kpi_summary: (p) => <KpiSummary {...p} />,
  execution_trend: (p) => <ExecutionTrend {...p} />,
  status_distribution: (p) => <StatusDistribution {...p} />,
  defect_aging: (p) => <DefectAging {...p} />,
  open_defects_by_severity: (p) => <OpenDefects {...p} />,
  release_readiness: (p) => <ReleaseReadiness {...p} />,
  defect_leakage: (p) => <DefectLeakage {...p} />,
  flaky_tests: (p) => <FlakyTests {...p} />,
  recent_activity: (p) => <RecentActivity {...p} />,
  saved_report: (p) => <SavedReportWidget {...p} />,
  my_assigned_cases: (p) => <MyAssignedCases {...p} />,
}

/** Renders one widget by its fixed type. Gating (hidden Reports, an invisible
 * project) is decided here, before any request is made. */
export function WidgetView({ widget }: { widget: DashboardWidget }) {
  const { user } = useAuth()
  const def = WIDGET_BY_TYPE[widget.widget_type]
  if (def.needsReports && user?.reports_hidden) {
    return (
      <Shell title={def.label}>
        <Note>Reports are hidden from Testers in this workspace, so this widget is unavailable.</Note>
      </Shell>
    )
  }
  if (widget.project_access === 'denied') {
    return (
      <Shell title={def.label}>
        <Note>No access to this project.</Note>
      </Shell>
    )
  }
  const pid = widget.settings.project_id ? String(widget.settings.project_id) : undefined
  return <>{RENDERERS[widget.widget_type]({ pid, settings: widget.settings })}</>
}
