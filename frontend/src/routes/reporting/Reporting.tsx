import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
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
  complianceExportUrl,
  type GroupBy,
  type Metric,
} from '@/api/reporting'
import { listFieldOptions } from '@/api/fieldCustomization'
import { listProjects } from '@/api/projects'
import { listUsers } from '@/api/users'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { useAuth } from '@/lib/auth'
import { isManagerOrAbove } from '@/api/auth'
import { pivotAggregateRows } from './aggregate'
import { categoricalColor, prefersDark, SEQUENTIAL_BLUE_LIGHT } from './palette'
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

export function Reporting() {
  const { user } = useAuth()
  const [metric, setMetric] = useState<Metric>('run_status')
  const [groupBy, setGroupBy] = useState<GroupBy>('project')
  const [chartType, setChartType] = useState<'bar' | 'pie' | 'line'>('bar')
  const [projectId, setProjectId] = useState('')
  const [domain, setDomain] = useState('')
  const [assigneeId, setAssigneeId] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [priority, setPriority] = useState('')
  const [status, setStatus] = useState('')
  const isDark = prefersDark()

  const projectsQuery = useQuery({ queryKey: ['projects', 'all'], queryFn: () => listProjects({ page_size: 100 }) })
  const usersQuery = useQuery({ queryKey: ['users', 'all'], queryFn: listUsers })
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
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Reporting</h1>
        {canExport && (
          <div className="flex gap-2">
            <a
              href="/reporting/print"
              className="rounded-md border border-[var(--border)] px-3 py-2 text-sm hover:bg-[var(--muted)]"
            >
              Compliance Report (Print / PDF)
            </a>
            <a
              href={complianceExportUrl(exportPeriod)}
              download
              className="rounded-md border border-[var(--border)] px-3 py-2 text-sm hover:bg-[var(--muted)]"
            >
              Download Compliance CSV
            </a>
          </div>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Filters</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-3">
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
            <Select aria-label="Domain" value={domain} onChange={(e) => setDomain(e.target.value)} className="w-36">
              <option value="">All domains</option>
              {DOMAINS.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </Select>
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
            <Select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)} className="w-40">
              <option value="">All statuses</option>
              {TEST_CASE_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s.replace(/_/g, ' ')}
                </option>
              ))}
            </Select>
            <Input
              aria-label="Date from"
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="w-40"
            />
            <Input
              aria-label="Date to"
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="w-40"
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Project &amp; Test Case Distribution by Domain</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={domainQuery.data ?? []} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke={isDark ? '#2c2c2a' : '#e1e0d9'} />
                <XAxis
                  dataKey="domain"
                  tick={{ fontSize: 12, fill: isDark ? '#c3c2b7' : '#52514e' }}
                  axisLine={{ stroke: isDark ? '#383835' : '#c3c2b7' }}
                  tickLine={false}
                />
                <YAxis
                  allowDecimals={false}
                  tick={{ fontSize: 12, fill: isDark ? '#c3c2b7' : '#52514e' }}
                  axisLine={false}
                  tickLine={false}
                  width={28}
                />
                <Tooltip
                  contentStyle={{
                    background: isDark ? '#1a1a19' : '#fcfcfb',
                    border: `1px solid ${isDark ? '#383835' : '#c3c2b7'}`,
                    borderRadius: 6,
                    fontSize: 12,
                  }}
                />
                <Bar dataKey="project_count" name="Projects" fill={SEQUENTIAL_BLUE_LIGHT} radius={[4, 4, 0, 0]} maxBarSize={48} />
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
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Execution Trends (last 30 days)</CardTitle>
        </CardHeader>
        <CardContent>
          {(trendQuery.data?.points.length ?? 0) === 0 ? (
            <p className="text-sm text-[var(--muted-foreground)]">No execution activity in this period yet.</p>
          ) : (
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={trendQuery.data?.points ?? []} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid vertical={false} stroke={isDark ? '#2c2c2a' : '#e1e0d9'} />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 12, fill: isDark ? '#c3c2b7' : '#52514e' }}
                    axisLine={{ stroke: isDark ? '#383835' : '#c3c2b7' }}
                    tickLine={false}
                  />
                  <YAxis
                    allowDecimals={false}
                    tick={{ fontSize: 12, fill: isDark ? '#c3c2b7' : '#52514e' }}
                    axisLine={false}
                    tickLine={false}
                    width={28}
                  />
                  <Tooltip
                    contentStyle={{
                      background: isDark ? '#1a1a19' : '#fcfcfb',
                      border: `1px solid ${isDark ? '#383835' : '#c3c2b7'}`,
                      borderRadius: 6,
                      fontSize: 12,
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Line type="monotone" dataKey="pass_count" name="Pass" stroke={categoricalColor(2, isDark)} strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="fail_count" name="Fail" stroke={categoricalColor(7, isDark)} strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="ignore_count" name="Ignored" stroke={categoricalColor(3, isDark)} strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Defect Trend (last 30 days)</CardTitle>
        </CardHeader>
        <CardContent>
          {(defectTrendQuery.data?.points.length ?? 0) === 0 ? (
            <p className="text-sm text-[var(--muted-foreground)]">No defect activity in this period yet.</p>
          ) : (
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={defectTrendQuery.data?.points ?? []} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid vertical={false} stroke={isDark ? '#2c2c2a' : '#e1e0d9'} />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 12, fill: isDark ? '#c3c2b7' : '#52514e' }}
                    axisLine={{ stroke: isDark ? '#383835' : '#c3c2b7' }}
                    tickLine={false}
                  />
                  <YAxis
                    allowDecimals={false}
                    tick={{ fontSize: 12, fill: isDark ? '#c3c2b7' : '#52514e' }}
                    axisLine={false}
                    tickLine={false}
                    width={28}
                  />
                  <Tooltip
                    contentStyle={{
                      background: isDark ? '#1a1a19' : '#fcfcfb',
                      border: `1px solid ${isDark ? '#383835' : '#c3c2b7'}`,
                      borderRadius: 6,
                      fontSize: 12,
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Line type="monotone" dataKey="opened_count" name="Opened" stroke={categoricalColor(7, isDark)} strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="closed_count" name="Closed" stroke={categoricalColor(2, isDark)} strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Defect Aging &amp; SLA</CardTitle>
        </CardHeader>
        <CardContent>
          {!defectAgingQuery.data || defectAgingQuery.data.total_open === 0 ? (
            <p className="text-sm text-[var(--muted-foreground)]">No open defects right now.</p>
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
              className="w-52"
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
              className="w-40"
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
              className="w-32"
            >
              <option value="bar">Bar chart</option>
              <option value="pie">Pie / donut</option>
              <option value="line">Line chart</option>
            </Select>
          </div>
          {groupBy === 'assignee' && (
            <p className="mb-4 text-xs text-[var(--muted-foreground)]">{ASSIGNEE_HINTS[metric]}</p>
          )}

          {aggregateData.length === 0 ? (
            <p className="text-sm text-[var(--muted-foreground)]">No data for this combination yet.</p>
          ) : chartType === 'bar' ? (
            <div className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={aggregateData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid vertical={false} stroke={isDark ? '#2c2c2a' : '#e1e0d9'} />
                  <XAxis
                    dataKey="group_label"
                    tick={{ fontSize: 12, fill: isDark ? '#c3c2b7' : '#52514e' }}
                    axisLine={{ stroke: isDark ? '#383835' : '#c3c2b7' }}
                    tickLine={false}
                  />
                  <YAxis
                    allowDecimals={false}
                    tick={{ fontSize: 12, fill: isDark ? '#c3c2b7' : '#52514e' }}
                    axisLine={false}
                    tickLine={false}
                    width={28}
                  />
                  <Tooltip
                    contentStyle={{
                      background: isDark ? '#1a1a19' : '#fcfcfb',
                      border: `1px solid ${isDark ? '#383835' : '#c3c2b7'}`,
                      borderRadius: 6,
                      fontSize: 12,
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  {valueOrder.map((value, i) => (
                    <Bar
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
                    contentStyle={{
                      background: isDark ? '#1a1a19' : '#fcfcfb',
                      border: `1px solid ${isDark ? '#383835' : '#c3c2b7'}`,
                      borderRadius: 6,
                      fontSize: 12,
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Pie data={pieData} dataKey="count" nameKey="value" innerRadius={60} outerRadius={110} paddingAngle={2}>
                    {pieData.map((entry, i) => (
                      <Cell key={entry.value} fill={categoricalColor(i, isDark)} stroke={isDark ? '#1a1a19' : '#fcfcfb'} />
                    ))}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={aggregateData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid vertical={false} stroke={isDark ? '#2c2c2a' : '#e1e0d9'} />
                  <XAxis
                    dataKey="group_label"
                    tick={{ fontSize: 12, fill: isDark ? '#c3c2b7' : '#52514e' }}
                    axisLine={{ stroke: isDark ? '#383835' : '#c3c2b7' }}
                    tickLine={false}
                  />
                  <YAxis
                    allowDecimals={false}
                    tick={{ fontSize: 12, fill: isDark ? '#c3c2b7' : '#52514e' }}
                    axisLine={false}
                    tickLine={false}
                    width={28}
                  />
                  <Tooltip
                    contentStyle={{
                      background: isDark ? '#1a1a19' : '#fcfcfb',
                      border: `1px solid ${isDark ? '#383835' : '#c3c2b7'}`,
                      borderRadius: 6,
                      fontSize: 12,
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  {valueOrder.map((value, i) => (
                    <Line
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
