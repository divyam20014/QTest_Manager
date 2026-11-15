import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, Check, X } from 'lucide-react'
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
import { CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { EmbossedCard } from '@/components/ui/EmbossedCard'
import { EmptyState, ErrorState } from '@/components/ui/empty-state'
import { GaugeDial } from '@/components/ui/GaugeDial'
import { ChartSkeleton, Skeleton } from '@/components/ui/skeleton'
import { TactileButton } from '@/components/ui/TactileButton'
import { humanizeActionCode } from '@/lib/labels'
import { categoricalColor, prefersDark } from '@/routes/reporting/palette'

// Tactile hover affordance for clickable dashboard tiles -- a lift via
// transform rather than overriding EmbossedCard's own box-shadow token
// (safer than fighting CSS specificity between the raised-elevation
// utility class and a Tailwind hover:shadow override).
const TILE_INTERACTIVE =
  'transition-transform duration-150 hover:-translate-y-0.5 motion-reduce:transition-none motion-reduce:hover:translate-y-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)] rounded-xl'

// Clicking a KPI, chart segment, or activity row should take you to the
// filtered list it summarizes, not just display a number (UX review
// bug #17) -- a route per entity_type the activity stream can report on.
const ENTITY_ROUTES: Record<string, string> = {
  test_case: '/test-cases',
  defect: '/defects',
  requirement: '/requirements',
  project: '/projects',
  test_run: '/test-runs',
}

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`
}

// A rate computed from a handful of steps looks just as confident as one
// backed by thousands -- "100% steps passing" off a single step is
// misleading, not informative. Below this sample size, show the sample
// alongside the percentage instead of a bare number.
const THIN_SAMPLE_THRESHOLD = 10

function formatPassRate(percentage: number, sampleSize: number): string {
  if (sampleSize === 0) return 'n/a'
  const pct = formatPercent(percentage)
  return sampleSize < THIN_SAMPLE_THRESHOLD
    ? `${pct} (${Math.round(percentage * sampleSize)} of ${sampleSize})`
    : pct
}

// Tier 5 / ADR-055: severity is tenant-configurable now -- these only
// cover the four seeded defaults, with a sensible fallback for anything
// a tenant has added (ranked last, shown neutral).
const SEVERITY_RANK: Partial<Record<Severity, number>> = { Critical: 0, High: 1, Medium: 2, Low: 3 }
const SEVERITY_TONE: Partial<Record<Severity, 'neutral' | 'positive' | 'warning' | 'critical'>> = {
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

const ONBOARDING_DISMISSED_KEY = 'qtesthub:onboarding-dismissed'

// UX review bug #16: a new user has no cue that the intended flow is
// Project -> Requirements -> Test Cases -> Run -> Execute -> Defect. A
// simple progress checklist (not a product-tour library) covers it,
// derived entirely from data the dashboard already fetches.
function OnboardingChecklist({
  hasProjects,
  hasTestCases,
  hasExecuted,
  onDismiss,
}: {
  hasProjects: boolean
  hasTestCases: boolean
  hasExecuted: boolean
  onDismiss: () => void
}) {
  const steps = [
    { label: 'Create a project', done: hasProjects, href: '/projects' },
    // Pass C (deferred item #3): `/test-cases` is not a real route (it
    // only exists as `/projects/:projectId/test-cases` and
    // `/test-cases/:testCaseId`) -- this link 404'd for any user who
    // clicked it. `/test-repository` is the actual cross-project view.
    { label: 'Write test cases', done: hasTestCases, href: '/test-repository' },
    { label: 'Create a test run and execute it', done: hasExecuted, href: '/test-runs' },
  ]
  return (
    <EmbossedCard>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle>Getting started</CardTitle>
        <TactileButton
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss getting-started checklist"
          size="sm"
          className="h-7 w-7 px-0"
        >
          <X className="size-4" />
        </TactileButton>
      </CardHeader>
      <CardContent>
        <ul className="flex flex-col gap-2 text-sm">
          {steps.map((step) => (
            <li key={step.label}>
              <Link
                to={step.href}
                className="flex items-center gap-2 rounded-md px-2 py-1.5 transition-colors hover:bg-[var(--muted)]"
              >
                <span
                  className={`flex size-5 shrink-0 items-center justify-center rounded-full border ${
                    step.done
                      ? 'border-[var(--status-positive)] bg-[var(--status-positive)] text-white'
                      : 'border-[var(--border)]'
                  }`}
                >
                  {step.done && <Check className="size-3.5" />}
                </span>
                <span className={step.done ? 'text-[var(--muted-foreground)] line-through' : ''}>
                  {step.label}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </CardContent>
    </EmbossedCard>
  )
}

export function Dashboard() {
  const isDark = prefersDark()
  const [activePieIndex, setActivePieIndex] = useState<number | null>(null)
  const [onboardingDismissed, setOnboardingDismissed] = useState(() => {
    try {
      return localStorage.getItem(ONBOARDING_DISMISSED_KEY) === '1'
    } catch {
      return false
    }
  })
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
        (SEVERITY_RANK[a.severity] ?? 99) - (SEVERITY_RANK[b.severity] ?? 99) ||
          b.created_at.localeCompare(a.created_at),
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

  const kpis: { title: string; value: string | number; detail: string; href?: string }[] = summary
    ? [
        {
          title: 'Total Projects',
          value: summary.projects.total,
          detail: Object.entries(summary.projects.by_status).map(([s, n]) => `${s}: ${n}`).join(', '),
          href: '/projects',
        },
        {
          title: 'Active Projects',
          value: summary.projects.active,
          detail: 'Not yet completed',
          href: '/projects?status=Active',
        },
        {
          title: 'Total Test Cases',
          value: summary.test_cases.total,
          detail: `${formatPercent(summary.test_cases.approved_ratio)} approved`,
          // `/test-cases` alone isn't a real route (test cases are always
          // scoped to a project or viewed via the cross-project
          // repository) -- `/test-repository` is that cross-project view.
          href: '/test-repository',
        },
        {
          title: 'Approved Test Cases',
          value: summary.test_cases.approved_count,
          detail: `of ${summary.test_cases.total} total`,
          href: '/test-repository?status=approved',
        },
        {
          title: 'Active Test Runs',
          value: summary.test_runs.active,
          detail: `${formatPassRate(summary.test_runs.step_pass_percentage, summary.test_runs.step_sample_size)} steps passing`,
          href: '/test-runs?status=in_progress',
        },
        {
          title: 'Open Defects',
          value: Object.values(summary.defects.open_by_severity).reduce((a, b) => a + b, 0),
          detail: Object.entries(summary.defects.open_by_severity).map(([s, n]) => `${s}: ${n}`).join(', '),
          href: '/defects',
        },
        {
          title: 'Critical Defects',
          value: summary.defects.critical_count,
          detail: 'open, Critical severity',
          href: '/defects?severity=Critical',
        },
      ]
    : []

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">Dashboard</h1>
          <p className="text-sm text-[var(--muted-foreground)]">
            Current testing status and project health at a glance.
          </p>
        </div>
      </div>

      {summary &&
        !onboardingDismissed &&
        !(summary.projects.total > 0 && summary.test_cases.total > 0 && summary.test_runs.step_sample_size > 0) && (
          <OnboardingChecklist
            hasProjects={summary.projects.total > 0}
            hasTestCases={summary.test_cases.total > 0}
            hasExecuted={summary.test_runs.step_sample_size > 0}
            onDismiss={() => {
              setOnboardingDismissed(true)
              try {
                localStorage.setItem(ONBOARDING_DISMISSED_KEY, '1')
              } catch {
                /* ignore -- dismiss still works for this session */
              }
            }}
          />
        )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {summaryQuery.isLoading &&
          Array.from({ length: 8 }).map((_, i) => (
            <EmbossedCard key={i}>
              <CardHeader>
                <Skeleton className="h-4 w-24" />
              </CardHeader>
              <CardContent>
                <Skeleton className="h-7 w-14" />
                <Skeleton className="mt-2 h-3 w-20" />
              </CardContent>
            </EmbossedCard>
          ))}
        {summaryQuery.isError && (
          <EmbossedCard className="sm:col-span-2 lg:col-span-4">
            <CardContent>
              <ErrorState onRetry={() => summaryQuery.refetch()} />
            </CardContent>
          </EmbossedCard>
        )}
        {kpis.map((kpi, i) => {
          const card = (
            <EmbossedCard
              className={`qth-animate-in h-full ${kpi.href ? `cursor-pointer ${TILE_INTERACTIVE}` : ''}`}
              style={{ animation: `qth-slide-in 0.25s ease-out ${i * 30}ms backwards` }}
            >
              <CardHeader>
                <CardTitle>{kpi.title}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-semibold">{kpi.value}</p>
                <p className="text-xs text-[var(--muted-foreground)]">{kpi.detail}</p>
              </CardContent>
            </EmbossedCard>
          )
          return kpi.href ? (
            <Link
              key={kpi.title}
              to={kpi.href}
              className={`block rounded-xl ${TILE_INTERACTIVE}`}
              aria-label={`View ${kpi.title}`}
            >
              {card}
            </Link>
          ) : (
            <div key={kpi.title}>{card}</div>
          )
        })}
        {summary && (
          <EmbossedCard
            className="qth-animate-in h-full"
            style={{ animation: `qth-slide-in 0.25s ease-out ${kpis.length * 30}ms backwards` }}
          >
            <CardHeader>
              <CardTitle>Execution Pass %</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col items-center gap-1 pt-0">
              <GaugeDial
                value={summary.test_runs.step_pass_percentage * 100}
                label="Execution pass rate"
                valueLabel={formatPassRate(summary.test_runs.step_pass_percentage, summary.test_runs.step_sample_size)}
              />
              <p className="text-xs text-[var(--muted-foreground)]">
                {summary.test_runs.step_sample_size === 0
                  ? 'No executed steps yet'
                  : summary.test_runs.step_sample_size < THIN_SAMPLE_THRESHOLD
                    ? 'small sample -- more executions will sharpen this'
                    : 'across all executed steps'}
              </p>
            </CardContent>
          </EmbossedCard>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <EmbossedCard className="lg:col-span-1">
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
            {defectsQuery.isLoading && (
              <div className="flex flex-col gap-2">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="h-9 w-full" />
                ))}
              </div>
            )}
            {defectsQuery.isError && <ErrorState onRetry={() => defectsQuery.refetch()} />}
            {!defectsQuery.isLoading && !defectsQuery.isError && needsAttention.length === 0 && (
              <EmptyState
                title="Nothing urgent"
                description="No open Critical or High severity defects right now."
              />
            )}
            <ul className="flex flex-col gap-2">
              {needsAttention.map((d) => (
                <li key={d.id}>
                  <Link
                    to={`/defects/${d.id}`}
                    className="flex items-center justify-between gap-3 rounded-md border border-[var(--border)] px-3 py-2 text-sm transition-colors hover:bg-[var(--muted)]"
                  >
                    <span className="min-w-0 truncate">{d.title}</span>
                    <Badge tone={SEVERITY_TONE[d.severity] ?? 'neutral'} className="shrink-0">
                      {d.severity}
                    </Badge>
                  </Link>
                </li>
              ))}
            </ul>
          </CardContent>
        </EmbossedCard>

        <EmbossedCard className="lg:col-span-1">
          <CardHeader>
            <CardTitle>Test Case Status</CardTitle>
          </CardHeader>
          <CardContent>
            {statusQuery.isLoading ? (
              <div className="h-56">
                <ChartSkeleton />
              </div>
            ) : statusQuery.isError ? (
              <ErrorState onRetry={() => statusQuery.refetch()} />
            ) : statusPieData.length === 0 ? (
              <EmptyState title="No test cases yet" description="Create your first test case to see a status breakdown here." />
            ) : (
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <defs>
                      {statusPieData.map((entry, i) => {
                        const color = categoricalColor(i, isDark)
                        return (
                          // Radial highlight toward the top-left, matching the
                          // app-wide emboss light-source convention -- gives
                          // slices a domed look without introducing any hue
                          // outside the validated categorical palette.
                          <radialGradient key={entry.status} id={`pie-grad-${i}`} cx="35%" cy="30%" r="75%">
                            <stop offset="0%" stopColor={color} stopOpacity={1} />
                            <stop offset="100%" stopColor={color} stopOpacity={0.78} />
                          </radialGradient>
                        )
                      })}
                    </defs>
                    <Tooltip
                      contentStyle={{
                        background: 'var(--tactile-surface-raised)',
                        border: 'none',
                        borderRadius: 10,
                        boxShadow: 'var(--elevation-raised-sm)',
                        fontSize: 12,
                        color: 'var(--foreground)',
                      }}
                      formatter={(value, name) => [`${value} test case${value === 1 ? '' : 's'}`, name]}
                    />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Pie
                      data={statusPieData}
                      dataKey="count"
                      nameKey="status"
                      innerRadius={44}
                      outerRadius={78}
                      paddingAngle={2}
                      cornerRadius={3}
                      stroke="var(--tactile-surface)"
                      strokeWidth={2}
                      isAnimationActive
                      animationDuration={500}
                      onMouseEnter={(_, i) => setActivePieIndex(i)}
                      onMouseLeave={() => setActivePieIndex(null)}
                    >
                      {statusPieData.map((entry, i) => (
                        <Cell
                          key={entry.status}
                          fill={`url(#pie-grad-${i})`}
                          style={{
                            filter:
                              activePieIndex === i ? 'drop-shadow(0 4px 7px rgba(0, 0, 0, 0.35))' : undefined,
                            transition: 'filter 150ms ease-out',
                          }}
                        />
                      ))}
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </EmbossedCard>

        <EmbossedCard className="lg:col-span-1">
          <CardHeader>
            <CardTitle>Execution Trend (30 days)</CardTitle>
          </CardHeader>
          <CardContent>
            {trendQuery.isLoading ? (
              <div className="h-56">
                <ChartSkeleton />
              </div>
            ) : trendQuery.isError ? (
              <ErrorState onRetry={() => trendQuery.refetch()} />
            ) : (trendQuery.data?.points.length ?? 0) === 0 ? (
              <EmptyState title="No execution activity yet" description="Run a test to see pass/fail trends here." />
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
                        background: 'var(--tactile-surface-raised)',
                        border: 'none',
                        borderRadius: 10,
                        boxShadow: 'var(--elevation-raised-sm)',
                        fontSize: 12,
                        color: 'var(--foreground)',
                      }}
                      cursor={{ stroke: 'var(--border)', strokeWidth: 1 }}
                    />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Line
                      type="monotone"
                      dataKey="pass_count"
                      name="Pass"
                      stroke={categoricalColor(2, isDark)}
                      strokeWidth={2.5}
                      dot={false}
                      activeDot={{ r: 5, strokeWidth: 2, style: { filter: 'drop-shadow(0 2px 5px rgba(0, 0, 0, 0.3))' } }}
                      isAnimationActive
                      animationDuration={500}
                    />
                    <Line
                      type="monotone"
                      dataKey="fail_count"
                      name="Fail"
                      stroke={categoricalColor(7, isDark)}
                      strokeWidth={2.5}
                      dot={false}
                      activeDot={{ r: 5, strokeWidth: 2, style: { filter: 'drop-shadow(0 2px 5px rgba(0, 0, 0, 0.3))' } }}
                      isAnimationActive
                      animationDuration={500}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </EmbossedCard>
      </div>

      <EmbossedCard>
        <CardHeader>
          <CardTitle>Recent Activity</CardTitle>
        </CardHeader>
        <CardContent>
          {activityQuery.isLoading && (
            <div className="flex flex-col gap-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-5 w-full" />
              ))}
            </div>
          )}
          {activityQuery.isError && <ErrorState onRetry={() => activityQuery.refetch()} />}
          <ul className="flex flex-col gap-2 text-sm">
            {!activityQuery.isLoading && activityQuery.data?.length === 0 && (
              <li>
                <EmptyState title="No activity yet" description="Actions across the tenant will show up here." />
              </li>
            )}
            {activityQuery.data?.map((entry, i) => {
              const entityRoute = ENTITY_ROUTES[entry.entity_type]
              const body = (
                <span>
                  <span className="font-medium">{entry.user_name ?? 'System'}</span>{' '}
                  <span className="text-[var(--muted-foreground)]">{humanizeActionCode(entry.action)}</span>{' '}
                  <span className="text-[var(--muted-foreground)]">
                    ({humanizeActionCode(entry.entity_type)})
                  </span>
                </span>
              )
              return (
                <li
                  key={i}
                  className="flex justify-between gap-4 border-b border-[var(--border)] pb-2 last:border-0"
                >
                  {entityRoute ? (
                    <Link
                      to={`${entityRoute}/${entry.entity_id}`}
                      className="min-w-0 hover:underline"
                      title="View this item"
                    >
                      {body}
                    </Link>
                  ) : (
                    body
                  )}
                  <span className="shrink-0 text-xs text-[var(--muted-foreground)]">
                    {new Date(entry.created_at).toLocaleString()}
                  </span>
                </li>
              )
            })}
          </ul>
        </CardContent>
      </EmbossedCard>
    </div>
  )
}
