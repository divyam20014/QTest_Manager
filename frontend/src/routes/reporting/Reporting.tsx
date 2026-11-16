import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

import {
  fetchAggregateReport,
  fetchDefectAgingSummary,
  fetchDefectTrend,
  fetchDomainDistribution,
  fetchExecutionTrend,
  complianceExportPdfUrl,
  complianceExportUrl,
  type GroupBy,
  type Metric,
} from '@/api/reporting'
import { listFieldOptions } from '@/api/fieldCustomization'
import { listProjects } from '@/api/projects'
import { listUsers } from '@/api/users'
import { buttonVariants } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ChartPanel } from '@/components/ui/ChartPanel'
import { PageHeader } from '@/components/ui/PageHeader'
import { FilterBar, FilterField } from '@/components/table/FilterBar'
import { DateRangePicker } from '@/components/ui/date-range-picker'
import { EmptyState, ErrorState } from '@/components/ui/empty-state'
import { Select } from '@/components/ui/select'
import { ChartSkeleton } from '@/components/ui/skeleton'
import { useAuth } from '@/lib/auth'
import { isManagerOrAbove } from '@/api/auth'
import { pivotAggregateRows } from './aggregate'
import { usePrefersReducedMotion } from '@/lib/useMediaQuery'
import { useThemePreference } from '@/lib/useThemePreference'
import { useCanListUsers } from '@/lib/useCanListUsers'
import { categoricalColor, CATEGORICAL_DARK, SEQUENTIAL_BLUE_LIGHT } from './palette'
import { QAManagerIntelligenceCard } from './QAManagerIntelligenceCard'

const METRICS: { value: Metric; label: string }[] = [
  { value: 'run_status', label: 'Test Run Status' },
  { value: 'priority', label: 'Test Case Priority' },
  { value: 'test_case_status', label: 'Test Case Status' },
  { value: 'defect_severity', label: 'Defect Severity' },
  { value: 'defect_status', label: 'Defect Status' },
  { value: 'defect_root_cause', label: 'Defect Root Cause' },
]

const GROUP_BYS: { value: GroupBy; label: string }[] = [
  { value: 'project', label: 'Project' },
  { value: 'domain', label: 'Domain' },
  { value: 'assignee', label: 'Assignee' },
]

const DOMAINS = ['Motor', 'Health', 'Travel', 'Life', 'Property']
const PRIORITIES = ['Low', 'Medium', 'High', 'Critical']
const TEST_CASE_STATUSES = ['draft', 'ready_for_review', 'approved', 'deprecated']

// What "Assignee" means shifts with the metric: a test-run-status or test-case
// row groups by the test case's owning project member, while a defect row
// groups by whoever the defect itself is assigned to. Disclosed in the UI so
// the grouping isn't read as one consistent "assignee" concept.
const ASSIGNEE_HINTS: Record<Metric, string> = {
  run_status: "Groups by the test case's assigned owner.",
  priority: "Groups by the test case's assigned owner.",
  test_case_status: "Groups by the test case's assigned owner.",
  defect_severity: 'Groups by the defect’s assignee.',
  defect_status: 'Groups by the defect’s assignee.',
  defect_root_cause: 'Groups by the defect’s assignee.',
}

const chartTooltipStyle = {
  background: 'var(--tactile-surface-raised)',
  border: 'none',
  borderRadius: 10,
  boxShadow: 'var(--elevation-raised-sm)',
  fontSize: 12,
  color: 'var(--foreground)',
}

export function Reporting() {
  const { user } = useAuth()
  const [metric, setMetric] = useState<Metric>('run_status')
  const [groupBy, setGroupBy] = useState<GroupBy>('project')
  const [chartType, setChartType] = useState<'bar' | 'pie' | 'line'>('bar')
  const [aggView, setAggView] = useState<'chart' | 'table'>('chart')
  const [projectId, setProjectId] = useState('')
  const [domain, setDomain] = useState('')
  const [assigneeId, setAssigneeId] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [priority, setPriority] = useState('')
  const [status, setStatus] = useState('')
  // The app's own light/dark toggle, not the OS setting: with the toggle on
  // dark and the OS on light the charts used to draw the light palette on a
  // dark card.
  const [theme] = useThemePreference()
  const reduceMotion = usePrefersReducedMotion()
  const isDark = theme === 'dark'

  // Pass 4 (ADR-065): a deep link from Project Detail's "Release Readiness"
  // button (`?project=<id>`) should actually pre-select this project, not
  // just land on the page and make the user pick it again from the
  // dropdown -- the same one-directional-read pattern used elsewhere
  // (Pass C follow-up's ProjectsList/TestRunsOverview fix).
  const [searchParams] = useSearchParams()
  useEffect(() => {
    const fromUrl = searchParams.get('project')
    if (fromUrl) setProjectId(fromUrl)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const projectsQuery = useQuery({ queryKey: ['projects', 'all'], queryFn: () => listProjects({ page_size: 100 }) })
  const canListUsers = useCanListUsers()
  const usersQuery = useQuery({ queryKey: ['users', 'all'], queryFn: listUsers, enabled: canListUsers })
  // Gap-closure pass (ADR-057): this filter targets test case priority
  // (the "priority" metric is "Test Case Priority"), so it reads the same
  // tenant-configured value set TestCasesList/TestCaseForm use, instead
  // of the fixed PRIORITIES fallback.
  const priorityOptionsQuery = useQuery({
    queryKey: ['field-options', 'test_case_priority'],
    queryFn: () => listFieldOptions('test_case_priority'),
  })
  const priorityFilterOptions: { code: string; label: string }[] = priorityOptionsQuery.data?.length
    ? priorityOptionsQuery.data.map((o) => ({ code: o.code, label: o.label }))
    : PRIORITIES.map((p) => ({ code: p, label: p }))
  const domainQuery = useQuery({ queryKey: ['dashboard', 'domain-distribution'], queryFn: fetchDomainDistribution })
  const trendQuery = useQuery({
    queryKey: ['reports', 'execution-trend', projectId],
    queryFn: () => fetchExecutionTrend(30, projectId || undefined),
  })
  const defectTrendQuery = useQuery({
    queryKey: ['reports', 'defect-trend', projectId],
    queryFn: () => fetchDefectTrend(30, projectId || undefined),
  })
  const defectAgingQuery = useQuery({
    queryKey: ['reports', 'defect-aging', projectId],
    queryFn: () => fetchDefectAgingSummary(projectId || undefined),
  })
  const filters = useMemo(
    () => ({
      projectId: projectId || undefined,
      domain: domain || undefined,
      assigneeId: assigneeId || undefined,
      dateFrom: dateFrom ? new Date(dateFrom).toISOString() : undefined,
      dateTo: dateTo ? new Date(dateTo).toISOString() : undefined,
      priority: priority || undefined,
      status: status || undefined,
    }),
    [projectId, domain, assigneeId, dateFrom, dateTo, priority, status]
  )
  const aggregateQuery = useQuery({
    queryKey: ['reports', 'aggregate', metric, groupBy, filters],
    queryFn: () => fetchAggregateReport(metric, groupBy, filters),
  })

  const { data: aggregateData, valueOrder } = pivotAggregateRows(aggregateQuery.data?.rows ?? [])
  const pieData = valueOrder.map((value) => ({
    value,
    count: aggregateData.reduce((sum, row) => sum + (Number(row[value]) || 0), 0),
  }))
  const canExport = isManagerOrAbove(user)
  const exportPeriod = {
    periodFrom: dateFrom ? new Date(dateFrom).toISOString() : undefined,
    periodTo: dateTo ? new Date(dateTo).toISOString() : undefined,
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Reporting"
        description="Release readiness, defect and execution analytics."
        actionsClassName="flex-col md:flex-row [&>a]:inline-flex [&>a]:min-h-11 [&>a]:items-center [&>a]:justify-center md:[&>a]:min-h-0 max-md:[&>a]:w-full"
        actions={
          canExport && (
            <>
            <a
              href="/reporting/print"
              className={buttonVariants({ variant: 'outline' })}
            >
              Compliance Report (Print / PDF)
            </a>
            <a
              href={complianceExportUrl(exportPeriod)}
              download
              className={buttonVariants({ variant: 'outline' })}
            >
              Download Compliance CSV
            </a>
            <a
              href={complianceExportPdfUrl(exportPeriod)}
              download
              className={buttonVariants({ variant: 'outline' })}
            >
              Download Compliance PDF
            </a>
            </>
          )
        }
      />

      <Card>
        <CardHeader>
          <CardTitle>Filters</CardTitle>
        </CardHeader>
        <CardContent>
          <FilterBar
            activeCount={[projectId, domain, assigneeId, priority, status, dateFrom || dateTo].filter(Boolean).length}
            onClear={() => {
              setProjectId('')
              setDomain('')
              setAssigneeId('')
              setPriority('')
              setStatus('')
              setDateFrom('')
              setDateTo('')
            }}
            desktopClear={false}
          >
            <FilterField label="Project">
            <Select
              aria-label="Project"
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
              className="w-44"
            >
              <option value="">All projects</option>
              {projectsQuery.data?.items.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
            </FilterField>
            <FilterField label="Domain">
            <Select aria-label="Domain" value={domain} onChange={(e) => setDomain(e.target.value)} className="w-36">
              <option value="">All domains</option>
              {DOMAINS.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </Select>
            </FilterField>
            <FilterField label="Assignee">
            <Select
              aria-label="Assignee"
              value={assigneeId}
              onChange={(e) => setAssigneeId(e.target.value)}
              className="w-44"
            >
              <option value="">All assignees</option>
              {usersQuery.data?.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </Select>
            </FilterField>
            <FilterField label="Priority">
            <Select
              aria-label="Priority"
              value={priority}
              onChange={(e) => setPriority(e.target.value)}
              className="w-36"
            >
              <option value="">All priorities</option>
              {priorityFilterOptions.map((p) => (
                <option key={p.code} value={p.code}>
                  {p.label}
                </option>
              ))}
            </Select>
            </FilterField>
            <FilterField label="Status">
            <Select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)} className="w-40">
              <option value="">All statuses</option>
              {TEST_CASE_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s.replace(/_/g, ' ')}
                </option>
              ))}
            </Select>
            </FilterField>
            <DateRangePicker
              idPrefix="reporting-date"
              fromValue={dateFrom}
              toValue={dateTo}
              onChange={(from, to) => {
                setDateFrom(from)
                setDateTo(to)
              }}
            />
          </FilterBar>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Project &amp; Test Case Distribution by Domain</CardTitle>
        </CardHeader>
        <CardContent>
          {domainQuery.isLoading ? (
            <div className="h-72"><ChartSkeleton /></div>
          ) : domainQuery.isError ? (
            <ErrorState onRetry={() => domainQuery.refetch()} />
          ) : (domainQuery.data ?? []).length === 0 ? (
            <EmptyState title="No domain data yet" description="Create a project with a domain to see this breakdown." />
          ) : (
          <>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={domainQuery.data ?? []} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
                <XAxis
                  dataKey="domain"
                  tick={{ fontSize: 12, fill: 'var(--chart-axis-text)' }}
                  axisLine={{ stroke: 'var(--chart-axis-line)' }}
                  tickLine={false}
                />
                <YAxis
                  allowDecimals={false}
                  tick={{ fontSize: 12, fill: 'var(--chart-axis-text)' }}
                  axisLine={false}
                  tickLine={false}
                  width={28}
                />
                <Tooltip
                  contentStyle={chartTooltipStyle}
                />
                <Bar isAnimationActive={!reduceMotion} dataKey="project_count" name="Projects" fill={isDark ? CATEGORICAL_DARK[0] : SEQUENTIAL_BLUE_LIGHT} radius={[4, 4, 0, 0]} maxBarSize={48} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {domainQuery.data?.map((d) => (
              <div key={d.domain} className="rounded-md border border-[var(--border)] p-3 text-sm">
                <p className="font-medium">{d.domain}</p>
                <p className="text-xs text-[var(--muted-foreground)]">
                  {d.test_case_count} test cases · {Math.round(d.approved_percentage)}% approved
                </p>
                <p className="text-xs text-[var(--muted-foreground)]">
                  {d.open_defect_count} open defects · {Math.round(d.pass_percentage)}% pass rate
                </p>
              </div>
            ))}
          </div>
          </>
          )}
        </CardContent>
      </Card>

      <ChartPanel
        title="Execution Trends (last 30 days)"
        bodyClassName="h-72 overflow-y-auto"
        summary={trendQuery.data?.points.length ? `Line chart of test step results over the last 30 days: ${trendQuery.data.points.reduce((a, p) => a + p.pass_count, 0)} passed, ${trendQuery.data.points.reduce((a, p) => a + p.fail_count, 0)} failed.` : undefined}
        table={trendQuery.data?.points.length ? { columns: ['Date', 'Pass', 'Fail', 'Ignored'], rows: trendQuery.data.points.map((p) => [p.date, p.pass_count, p.fail_count, p.ignore_count]) } : undefined}
      >
          {trendQuery.isLoading ? (
            <ChartSkeleton />
          ) : trendQuery.isError ? (
            <ErrorState onRetry={() => trendQuery.refetch()} />
          ) : (trendQuery.data?.points.length ?? 0) === 0 ? (
            <EmptyState title="No execution activity in this period" description="Try widening the date range, or run a test to generate data." />
          ) : (
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={trendQuery.data?.points ?? []} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 12, fill: 'var(--chart-axis-text)' }}
                    axisLine={{ stroke: 'var(--chart-axis-line)' }}
                    tickLine={false}
                  />
                  <YAxis
                    allowDecimals={false}
                    tick={{ fontSize: 12, fill: 'var(--chart-axis-text)' }}
                    axisLine={false}
                    tickLine={false}
                    width={28}
                  />
                  <Tooltip
                    contentStyle={chartTooltipStyle}
                  />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Line isAnimationActive={!reduceMotion} type="monotone" dataKey="pass_count" name="Pass" stroke={categoricalColor(2, isDark)} strokeWidth={2} dot={false} />
                  <Line isAnimationActive={!reduceMotion} type="monotone" dataKey="fail_count" name="Fail" stroke={categoricalColor(7, isDark)} strokeWidth={2} dot={false} />
                  <Line isAnimationActive={!reduceMotion} type="monotone" dataKey="ignore_count" name="Ignored" stroke={categoricalColor(3, isDark)} strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
      </ChartPanel>

      <ChartPanel
        title="Defect Trend (last 30 days)"
        bodyClassName="h-72 overflow-y-auto"
        summary={defectTrendQuery.data?.points.length ? `Line chart of defects over the last 30 days: ${defectTrendQuery.data.points.reduce((a, p) => a + p.opened_count, 0)} opened, ${defectTrendQuery.data.points.reduce((a, p) => a + p.closed_count, 0)} closed.` : undefined}
        table={defectTrendQuery.data?.points.length ? { columns: ['Date', 'Opened', 'Closed'], rows: defectTrendQuery.data.points.map((p) => [p.date, p.opened_count, p.closed_count]) } : undefined}
      >
          {defectTrendQuery.isLoading ? (
            <ChartSkeleton />
          ) : defectTrendQuery.isError ? (
            <ErrorState onRetry={() => defectTrendQuery.refetch()} />
          ) : (defectTrendQuery.data?.points.length ?? 0) === 0 ? (
            <EmptyState title="No defect activity in this period" description="Try widening the date range, or report a defect to generate data." />
          ) : (
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={defectTrendQuery.data?.points ?? []} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 12, fill: 'var(--chart-axis-text)' }}
                    axisLine={{ stroke: 'var(--chart-axis-line)' }}
                    tickLine={false}
                  />
                  <YAxis
                    allowDecimals={false}
                    tick={{ fontSize: 12, fill: 'var(--chart-axis-text)' }}
                    axisLine={false}
                    tickLine={false}
                    width={28}
                  />
                  <Tooltip
                    contentStyle={chartTooltipStyle}
                  />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Line isAnimationActive={!reduceMotion} type="monotone" dataKey="opened_count" name="Opened" stroke={categoricalColor(7, isDark)} strokeWidth={2} dot={false} />
                  <Line isAnimationActive={!reduceMotion} type="monotone" dataKey="closed_count" name="Closed" stroke={categoricalColor(2, isDark)} strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
      </ChartPanel>

      <Card>
        <CardHeader>
          <CardTitle>Defect Aging &amp; SLA</CardTitle>
        </CardHeader>
        <CardContent>
          {defectAgingQuery.isLoading ? (
            <div className="flex flex-col gap-2">
              <div className="h-4 w-40 animate-pulse rounded-md bg-[var(--muted)]" />
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="h-16 animate-pulse rounded-md bg-[var(--muted)]" />
                ))}
              </div>
            </div>
          ) : defectAgingQuery.isError ? (
            <ErrorState onRetry={() => defectAgingQuery.refetch()} />
          ) : !defectAgingQuery.data || defectAgingQuery.data.total_open === 0 ? (
            <EmptyState title="No open defects right now" description="Everything reported so far has been resolved." />
          ) : (
            <>
              <p className="mb-3 text-sm">
                {defectAgingQuery.data.total_open} open ·{' '}
                <span className={defectAgingQuery.data.total_breached > 0 ? 'text-[var(--destructive)]' : ''}>
                  {defectAgingQuery.data.total_breached} breaching SLA
                </span>
              </p>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {defectAgingQuery.data.buckets
                  .filter((b) => b.open_count > 0)
                  .map((b) => (
                    <div key={b.severity} className="rounded-md border border-[var(--border)] p-3 text-sm">
                      <p className="font-medium">{b.severity}</p>
                      <p className="text-xs text-[var(--muted-foreground)]">
                        {b.open_count} open ·{' '}
                        {b.breached_count > 0 ? (
                          <span className="text-[var(--destructive)]">{b.breached_count} breached</span>
                        ) : (
                          '0 breached'
                        )}
                      </p>
                    </div>
                  ))}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {projectId ? (
        <QAManagerIntelligenceCard projectId={projectId} />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>QA Manager Intelligence</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-[var(--muted-foreground)]">
              Select a project above to see release readiness, workload, and flaky-test trends.
            </p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Aggregate Report</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="mb-2 flex flex-wrap gap-3">
            <Select
              aria-label="Metric"
              value={metric}
              onChange={(e) => setMetric(e.target.value as Metric)}
              className="w-52 max-md:w-full"
            >
              {METRICS.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </Select>
            <Select
              aria-label="Group by"
              value={groupBy}
              onChange={(e) => setGroupBy(e.target.value as GroupBy)}
              className="w-40 max-md:w-full"
            >
              {GROUP_BYS.map((g) => (
                <option key={g.value} value={g.value}>
                  By {g.label}
                </option>
              ))}
            </Select>
            <Select
              aria-label="Chart type"
              value={chartType}
              onChange={(e) => setChartType(e.target.value as 'bar' | 'pie' | 'line')}
              className="w-32 max-md:w-full"
            >
              <option value="bar">Bar chart</option>
              <option value="pie">Pie / donut</option>
              <option value="line">Line chart</option>
            </Select>
            <button
              type="button"
              aria-pressed={aggView === 'table'}
              onClick={() => setAggView(aggView === 'table' ? 'chart' : 'table')}
              className="inline-flex items-center rounded-md px-1.5 text-sm text-[var(--link)] hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)] max-md:min-h-11"
            >
              {aggView === 'table' ? 'View as chart' : 'View as table'}
            </button>
          </div>
          {groupBy === 'assignee' && (
            <p className="mb-4 text-xs text-[var(--muted-foreground)]">{ASSIGNEE_HINTS[metric]}</p>
          )}

          {aggregateQuery.isLoading ? (
            <div className="h-80"><ChartSkeleton /></div>
          ) : aggregateQuery.isError ? (
            <ErrorState onRetry={() => aggregateQuery.refetch()} />
          ) : aggregateData.length === 0 ? (
            <EmptyState title="No data for this combination" description="Try a different metric, group-by, or widen the date range." />
          ) : aggView === 'table' ? (
            <div className="max-h-80 overflow-auto">
              <table className="w-full text-left text-sm">
                <caption className="sr-only">Aggregate report data</caption>
                <thead className="sticky top-0 bg-[var(--background)]">
                  <tr>
                    <th scope="col" className="px-2 py-1.5 font-medium text-[var(--muted-foreground)]">
                      Group
                    </th>
                    {valueOrder.map((v) => (
                      <th key={v} scope="col" className="px-2 py-1.5 font-medium text-[var(--muted-foreground)]">
                        {v}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {aggregateData.map((row) => (
                    <tr key={String(row.group_label)} className="border-t border-[var(--border)]">
                      <th scope="row" className="px-2 py-1.5 font-normal">
                        {String(row.group_label)}
                      </th>
                      {valueOrder.map((v) => (
                        <td key={v} className="px-2 py-1.5 tabular-nums">
                          {Number(row[v]) || 0}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : chartType === 'bar' ? (
            <div className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={aggregateData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
                  <XAxis
                    dataKey="group_label"
                    tick={{ fontSize: 12, fill: 'var(--chart-axis-text)' }}
                    axisLine={{ stroke: 'var(--chart-axis-line)' }}
                    tickLine={false}
                  />
                  <YAxis
                    allowDecimals={false}
                    tick={{ fontSize: 12, fill: 'var(--chart-axis-text)' }}
                    axisLine={false}
                    tickLine={false}
                    width={28}
                  />
                  <Tooltip
                    contentStyle={chartTooltipStyle}
                  />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  {valueOrder.map((value, i) => (
                    <Bar
                      isAnimationActive={!reduceMotion}
                      key={value}
                      dataKey={value}
                      name={value}
                      stackId="agg"
                      fill={categoricalColor(i, isDark)}
                      radius={i === valueOrder.length - 1 ? [4, 4, 0, 0] : undefined}
                    />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : chartType === 'pie' ? (
            <div className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Tooltip
                    contentStyle={chartTooltipStyle}
                  />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Pie isAnimationActive={!reduceMotion} data={pieData} dataKey="count" nameKey="value" innerRadius={60} outerRadius={110} paddingAngle={2}>
                    {pieData.map((entry, i) => (
                      <Cell key={entry.value} fill={categoricalColor(i, isDark)} stroke="var(--tactile-surface-raised)" />
                    ))}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={aggregateData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
                  <XAxis
                    dataKey="group_label"
                    tick={{ fontSize: 12, fill: 'var(--chart-axis-text)' }}
                    axisLine={{ stroke: 'var(--chart-axis-line)' }}
                    tickLine={false}
                  />
                  <YAxis
                    allowDecimals={false}
                    tick={{ fontSize: 12, fill: 'var(--chart-axis-text)' }}
                    axisLine={false}
                    tickLine={false}
                    width={28}
                  />
                  <Tooltip
                    contentStyle={chartTooltipStyle}
                  />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  {valueOrder.map((value, i) => (
                    <Line
                      isAnimationActive={!reduceMotion}
                      key={value}
                      type="monotone"
                      dataKey={value}
                      name={value}
                      stroke={categoricalColor(i, isDark)}
                      strokeWidth={2}
                      dot={{ r: 3 }}
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
