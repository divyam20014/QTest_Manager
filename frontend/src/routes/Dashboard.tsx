import { useQuery } from '@tanstack/react-query'
import { AlertTriangle } from 'lucide-react'
import { Link } from 'react-router-dom'
import {
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

import { fetchActivityStream, fetchAggregateReport, fetchDashboardSummary, fetchExecutionTrend } from '@/api/reporting'
import { listDefects, type Severity } from '@/api/defects'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { categoricalColor, prefersDark } from '@/routes/reporting/palette'

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`
}

const SEVERITY_RANK: Record<Severity, number> = { Critical: 0, High: 1, Medium: 2, Low: 3 }
const SEVERITY_TONE: Record<Severity, 'neutral' | 'positive' | 'warning' | 'critical'> = {
  Critical: 'critical',
  High: 'critical',
  Medium: 'warning',
  Low: 'neutral',
}

const STATUS_LABELS: Record<string, string> = {
  draft: 'Draft',
  ready_for_review: 'Ready for Review',
  approved: 'Approved',
  deprecated: 'Deprecated',
}

export function Dashboard() {
  const isDark = prefersDark()
  const summaryQuery = useQuery({ queryKey: ['dashboard', 'summary'], queryFn: fetchDashboardSummary })
  const activityQuery = useQuery({ queryKey: ['dashboard', 'activity'], queryFn: fetchActivityStream })
  const trendQuery = useQuery({ queryKey: ['dashboard', 'execution-trend'], queryFn: () => fetchExecutionTrend(30) })
  const statusQuery = useQuery({
    queryKey: ['dashboard', 'test-case-status'],
    queryFn: () => fetchAggregateReport('test_case_status', 'project'),
  })
  const defectsQuery = useQuery({ queryKey: ['dashboard', 'defects-all'], queryFn: () => listDefects() })

  const summary = summaryQuery.data

  // "Needs Attention": open (not Closed) Critical/High defects, worst-first
  // -- the dashboard's one genuinely actionable list, not a decorative
  // count. Reuses the existing tenant-wide /defects endpoint with no new
  // backend work.
  const needsAttention = (defectsQuery.data ?? [])
    .filter((d) => d.status !== 'Closed' && (d.severity === 'Critical' || d.severity === 'High'))
    .sort(
      (a, b) =>
        SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || b.created_at.localeCompare(a.created_at),
    )
    .slice(0, 6)

  const statusTotals = new Map<string, number>()
  for (const row of statusQuery.data?.rows ?? []) {
    statusTotals.set(row.value, (statusTotals.get(row.value) ?? 0) + row.count)
  }
  const statusPieData = [...statusTotals.entries()].map(([status, count]) => ({
    status: STATUS_LABELS[status] ?? status,
    count,
  }))

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-lg font-semibold">Dashboard</h1>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader>
            <CardTitle>Total Projects</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold">{summary?.projects.total ?? '–'}</p>
            <p className="text-xs text-[var(--muted-foreground)]">
              {summary ? Object.entries(summary.projects.by_status).map(([s, n]) => `${s}: ${n}`).join(', ') : ''}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Active Projects</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold">{summary?.projects.active ?? '–'}</p>
            <p className="text-xs text-[var(--muted-foreground)]">Not yet completed</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Total Test Cases</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold">{summary?.test_cases.total ?? '–'}</p>
            <p className="text-xs text-[var(--muted-foreground)]">
              {summary ? formatPercent(summary.test_cases.approved_ratio) : ''} approved
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Approved Test Cases</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold">{summary?.test_cases.approved_count ?? '–'}</p>
            <p className="text-xs text-[var(--muted-foreground)]">of {summary?.test_cases.total ?? 0} total</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Active Test Runs</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold">{summary?.test_runs.active ?? '–'}</p>
            <p className="text-xs text-[var(--muted-foreground)]">
              {summary ? formatPercent(summary.test_runs.step_pass_percentage) : ''} steps passing
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Execution Pass %</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold">
              {summary ? formatPercent(summary.test_runs.step_pass_percentage) : '–'}
            </p>
            <p className="text-xs text-[var(--muted-foreground)]">across all executed steps</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Open Defects</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold">
              {summary ? Object.values(summary.defects.open_by_severity).reduce((a, b) => a + b, 0) : '–'}
            </p>
            <p className="text-xs text-[var(--muted-foreground)]">
              {summary
                ? Object.entries(summary.defects.open_by_severity).map(([s, n]) => `${s}: ${n}`).join(', ')
                : ''}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Critical Defects</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold">{summary?.defects.critical_count ?? '–'}</p>
            <p className="text-xs text-[var(--muted-foreground)]">open, Critical severity</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle className="flex items-center gap-1.5">
              <AlertTriangle className="size-3.5 text-[var(--status-warning)]" />
              Needs Attention
            </CardTitle>
            <Link to="/defects" className="text-xs text-[var(--link)] hover:underline">
              View all →
            </Link>
          </CardHeader>
          <CardContent>
            {defectsQuery.isLoading && <p className="text-sm text-[var(--muted-foreground)]">Loading…</p>}
            {!defectsQuery.isLoading && needsAttention.length === 0 && (
              <p className="text-sm text-[var(--muted-foreground)]">
                No open Critical or High severity defects. Nothing urgent to act on.
              </p>
            )}
            <ul className="flex flex-col gap-2">
              {needsAttention.map((d) => (
                <li key={d.id}>
                  <Link
                    to={`/defects/${d.id}`}
                    className="flex items-center justify-between gap-3 rounded-md border border-[var(--border)] px-3 py-2 text-sm hover:bg-[var(--muted)]"
                  >
                    <span className="min-w-0 truncate">{d.title}</span>
                    <Badge tone={SEVERITY_TONE[d.severity]} className="shrink-0">
                      {d.severity}
                    </Badge>
                  </Link>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle>Test Case Status</CardTitle>
          </CardHeader>
          <CardContent>
            {statusPieData.length === 0 ? (
              <p className="text-sm text-[var(--muted-foreground)]">No test cases yet.</p>
            ) : (
              <div className="h-56">
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
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Pie
                      data={statusPieData}
                      dataKey="count"
                      nameKey="status"
                      innerRadius={44}
                      outerRadius={78}
                      paddingAngle={2}
                    >
                      {statusPieData.map((entry, i) => (
                        <Cell key={entry.status} fill={categoricalColor(i, isDark)} />
                      ))}
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle>Execution Trend (30 days)</CardTitle>
          </CardHeader>
          <CardContent>
            {(trendQuery.data?.points.length ?? 0) === 0 ? (
              <p className="text-sm text-[var(--muted-foreground)]">No execution activity yet.</p>
            ) : (
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={trendQuery.data?.points ?? []} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                    <CartesianGrid vertical={false} stroke={isDark ? '#2c2c2a' : '#e1e0d9'} />
                    <XAxis
                      dataKey="date"
                      tick={{ fontSize: 10, fill: isDark ? '#c3c2b7' : '#52514e' }}
                      axisLine={{ stroke: isDark ? '#383835' : '#c3c2b7' }}
                      tickLine={false}
                    />
                    <YAxis
                      allowDecimals={false}
                      tick={{ fontSize: 10, fill: isDark ? '#c3c2b7' : '#52514e' }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <Tooltip
                      contentStyle={{
                        background: isDark ? '#1a1a19' : '#fcfcfb',
                        border: `1px solid ${isDark ? '#383835' : '#c3c2b7'}`,
                        borderRadius: 6,
                        fontSize: 12,
                      }}
                    />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Line type="monotone" dataKey="pass_count" name="Pass" stroke={categoricalColor(2, isDark)} strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="fail_count" name="Fail" stroke={categoricalColor(7, isDark)} strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Recent Activity</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="flex flex-col gap-2 text-sm">
            {activityQuery.data?.length === 0 && (
              <li className="text-[var(--muted-foreground)]">No activity yet.</li>
            )}
            {activityQuery.data?.map((entry, i) => (
              <li key={i} className="flex justify-between gap-4 border-b border-[var(--border)] pb-2 last:border-0">
                <span>
                  <span className="font-medium">{entry.user_name ?? 'System'}</span>{' '}
                  <span className="text-[var(--muted-foreground)]">{entry.action.replace(/_/g, ' ')}</span>{' '}
                  <span className="text-[var(--muted-foreground)]">({entry.entity_type})</span>
                </span>
                <span className="shrink-0 text-xs text-[var(--muted-foreground)]">
                  {new Date(entry.created_at).toLocaleString()}
                </span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  )
}
