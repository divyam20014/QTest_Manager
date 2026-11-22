import { lazy, Suspense, useState, type ReactNode } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { AlertTriangle, Check, X } from 'lucide-react'
import { Link, useSearchParams } from 'react-router-dom'

import { listAllTestRuns } from '@/api/execution'
import { fetchActivityStream, fetchAggregateReport, fetchDashboardSummary, fetchExecutionTrend } from '@/api/reporting'
import { hasPermission } from '@/api/auth'
import { listDefects } from '@/api/defects'
import { listProjects } from '@/api/projects'
import { Badge } from '@/components/ui/badge'
import { ChartLegend, ChartPanel, RangeControl } from '@/components/ui/ChartPanel'
import { PageHeader } from '@/components/ui/PageHeader'
import { CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { EmbossedCard } from '@/components/ui/EmbossedCard'
import { EmptyState, ErrorState } from '@/components/ui/empty-state'
import { Combobox } from '@/components/ui/combobox'
import { buttonVariants } from '@/components/ui/button'
import { DashboardSwitcher } from '@/routes/dashboards/DashboardSwitcher'
import { ChartSkeleton, Skeleton } from '@/components/ui/skeleton'
import { TactileButton } from '@/components/ui/TactileButton'
import { humanizeActionCode } from '@/lib/labels'
import { longDay } from '@/routes/dashboardFormat'
import { useAuth } from '@/lib/auth'
import { getQuickCreateActions } from '@/lib/quickCreate'
import { canAccessPath } from '@/lib/routeAccess'
import { levelTone } from '@/lib/statusTones'
import { usePrefersReducedMotion } from '@/lib/useMediaQuery'
import { useThemePreference } from '@/lib/useThemePreference'
import { capCategories, buildNeedsAttention, countTrend, rateTrend } from '@/routes/dashboardKpi'
import { KpiCard, KpiCardSkeleton } from '@/routes/dashboardKpiCard'
import { categoricalColor } from '@/routes/reporting/palette'

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
          className="size-8 px-0 max-md:size-11"
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
                      ? 'border-[var(--status-good)] bg-[var(--status-good)] text-white'
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

// Test case lifecycle -> palette slot. Colour follows the *entity* (a status
// keeps its colour whichever statuses happen to exist), never its rank in the
// current data. Slots are the first four of the validated categorical order.
const STATUS_SLOT: Record<string, number> = { draft: 0, ready_for_review: 1, approved: 2, deprecated: 3 }
const STATUS_ORDER = ['draft', 'ready_for_review', 'approved', 'deprecated']

const TREND_RANGES = [
  { value: 7, label: '7d' },
  { value: 30, label: '30d' },
  { value: 90, label: '90d' },
]

const ACTIVITY_PREVIEW = 8

// Recharts is heavy: load it only once the Dashboard has rendered its headline content.
const StatusDonutChart = lazy(() => import('@/routes/dashboardCharts').then((m) => ({ default: m.StatusDonutChart })))
const TrendLineChart = lazy(() => import('@/routes/dashboardCharts').then((m) => ({ default: m.TrendLineChart })))

const RELATIVE_UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 31536000],
  ['month', 2592000],
  ['day', 86400],
  ['hour', 3600],
  ['minute', 60],
]
function relativeTime(iso: string): string {
  const seconds = (Date.parse(iso) - Date.now()) / 1000
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })
  for (const [unit, size] of RELATIVE_UNITS) {
    if (Math.abs(seconds) >= size) return rtf.format(Math.round(seconds / size), unit)
  }
  return 'just now'
}

function Section({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-1 gap-4 md:grid-cols-12">{children}</div>
}

function initialsOf(name: string | null): string {
  const parts = (name ?? 'System').trim().split(/\s+/).filter(Boolean)
  return ((parts[0]?.[0] ?? 'S') + (parts.length > 1 ? (parts[parts.length - 1][0] ?? '') : '')).toUpperCase()
}

export function Dashboard() {
  const [theme] = useThemePreference()
  const reduceMotion = usePrefersReducedMotion()
  // The app's light/dark toggle (data-theme) is the source of truth -- the
  // OS media query alone gave a light chart palette on a dark surface
  // whenever the two disagreed.
  const isDark = theme === 'dark'
  const [trendDays, setTrendDays] = useState(30)
  const [onboardingDismissed, setOnboardingDismissed] = useState(() => {
    try {
      return localStorage.getItem(ONBOARDING_DISMISSED_KEY) === '1'
    } catch {
      return false
    }
  })
  // ADR-079: the whole Dashboard can be narrowed to one project. The choice lives in the URL
  // (`?project=<id>`) so it can be shared and survives a reload.
  const [searchParams, setSearchParams] = useSearchParams()
  const projectsQuery = useQuery({ queryKey: ['projects', 'all'], queryFn: () => listProjects({ page_size: 100 }) })
  const projects = projectsQuery.data?.items ?? []
  const requestedProject = searchParams.get('project') ?? ''
  // An id that is not one of the caller's projects (deleted, or someone else's link) is ignored;
  // until the list loads the URL value is trusted so a deep link does not fire unfiltered requests first.
  const projectId =
    requestedProject && (projectsQuery.isLoading || projects.some((p) => p.id === requestedProject))
      ? requestedProject
      : ''
  const projectFilter = projectId || undefined
  const selectedProject = projects.find((p) => p.id === projectId)
  function chooseProject(id: string) {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        if (id) next.set('project', id)
        else next.delete('project')
        return next
      },
      { replace: true },
    )
  }
  const { user } = useAuth()
  // ADR-093: Testers may be denied the report endpoints; those two widgets are then hidden.
  const reportsHidden = !!user?.reports_hidden
  // One retry (not the default three with back-off) so a failing API shows the
  // error state with its Retry button within ~2s instead of ~7s of skeletons.
  const summaryQuery = useQuery({
    queryKey: ['dashboard', 'summary', projectId],
    queryFn: () => fetchDashboardSummary(projectFilter),
    retry: 1,
  })
  const activityQuery = useQuery({
    queryKey: ['dashboard', 'activity', projectId],
    queryFn: () => fetchActivityStream(projectFilter),
    retry: 1,
  })
  const trendQuery = useQuery({
    queryKey: ['dashboard', 'execution-trend', trendDays, projectId],
    queryFn: () => fetchExecutionTrend(trendDays, projectFilter),
    placeholderData: keepPreviousData,
    retry: 1,
    enabled: !reportsHidden,
  })
  const statusQuery = useQuery({
    queryKey: ['dashboard', 'test-case-status', projectId],
    queryFn: () => fetchAggregateReport('test_case_status', 'project', { projectId: projectFilter }),
    retry: 1,
    enabled: !reportsHidden,
  })
  const defectsQuery = useQuery({
    queryKey: ['dashboard', 'defects-all', projectId],
    queryFn: () => listDefects({ project_id: projectFilter }),
    retry: 1,
  })
  // Paused (stalled) active runs feed "Needs attention"; the endpoint is already role/project scoped.
  const runsQuery = useQuery({
    queryKey: ['dashboard', 'active-runs', projectId],
    queryFn: () => listAllTestRuns({ project_id: projectFilter, active_only: true, page_size: 50 }),
    retry: 1,
  })

  const summary = summaryQuery.data

  // "Needs attention": open Critical/High defects worst-first, then paused runs.
  const attention = buildNeedsAttention(defectsQuery.data ?? [], runsQuery.data?.items ?? [])
  const attentionShown = attention.slice(0, 6)

  const statusTotals = new Map<string, number>()
  for (const row of statusQuery.data?.rows ?? []) {
    statusTotals.set(row.value, (statusTotals.get(row.value) ?? 0) + row.count)
  }
  const statusRows = [...statusTotals.entries()]
    .map(([key, count]) => ({
      key,
      status: STATUS_LABELS[key] ?? key,
      count,
      color: categoricalColor(STATUS_SLOT[key] ?? STATUS_ORDER.length + 1, isDark),
    }))
    .sort((a, b) => {
      const ai = STATUS_ORDER.indexOf(a.key)
      const bi = STATUS_ORDER.indexOf(b.key)
      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi)
    })
  // Max five slices; any tail is folded into one muted "Other" so the donut stays readable.
  const statusPieData = capCategories(statusRows, 5, (_rest, count) => ({
    key: 'other',
    status: 'Other',
    count,
    color: 'var(--muted-foreground)',
  }))
  const statusTotal = statusPieData.reduce((sum, d) => sum + d.count, 0)

  const trendPoints = trendQuery.data?.points ?? []
  const passTotal = trendPoints.reduce((sum, p) => sum + p.pass_count, 0)
  const failTotal = trendPoints.reduce((sum, p) => sum + p.fail_count, 0)
  const passColor = categoricalColor(2, isDark)
  const failColor = categoricalColor(7, isDark)

  const openDefects = summary ? Object.values(summary.defects.open_by_severity).reduce((a, b) => a + b, 0) : 0
  const prev = summary?.previous
  const days = prev?.days ?? 30
  const sample = summary?.test_runs.step_sample_size ?? 0
  const hasPassData = sample > 0
  const kpis = summary
    ? [
        {
          label: 'Pass rate',
          value: hasPassData ? formatPercent(summary.test_runs.step_pass_percentage) : '--',
          trend: rateTrend(summary.test_runs.step_pass_percentage, sample, prev?.step_pass_percentage, prev?.step_sample_size, days),
          href: reportsHidden ? '/test-runs' : '/reporting',
          ringPercent: hasPassData ? summary.test_runs.step_pass_percentage * 100 : 0,
        },
        {
          label: 'Active runs',
          value: summary.test_runs.active.toLocaleString(),
          trend: countTrend(summary.test_runs.active, prev?.active_runs, days, true),
          href: '/test-runs?status=in_progress',
        },
        {
          label: 'Open defects',
          value: openDefects.toLocaleString(),
          trend: countTrend(openDefects, prev?.open_defects, days, false),
          href: '/defects',
        },
        {
          label: 'Test cases',
          value: summary.test_cases.total.toLocaleString(),
          trend: countTrend(summary.test_cases.total, prev?.test_cases_total, days, true),
          href: '/test-repository',
        },
      ]
    : []

  // "Start a test run": runs are created inside a project, so use the chosen (or only) project;
  // otherwise the runs overview. Hidden for users without the create permission.
  const runProjectId = projectId || (projects.length === 1 ? projects[0].id : undefined)
  const startRun = getQuickCreateActions(user, runProjectId).find((a) => a.kind === 'test-run')
  const startRunHref = startRun?.path ?? (hasPermission(user, 'testrun.create') ? '/test-runs' : null)
  const startRunAction = startRunHref ? (
    <Link to={startRunHref} className={buttonVariants({ size: 'sm' })}>
      Start a test run
    </Link>
  ) : undefined
  const canSeeAudit = canAccessPath(user, '/admin/audit-logs')

  const activity = activityQuery.data ?? []
  const activityShown = activity.slice(0, ACTIVITY_PREVIEW)

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Dashboard"
        description={
          selectedProject
            ? `Current testing status for ${selectedProject.name}.`
            : 'Current testing status and project health at a glance.'
        }
        actions={
          <>
            {projects.length > 1 ? (
              <div className="flex items-center gap-2 max-md:w-full">
                <label htmlFor="dashboard-project" className="text-sm text-[var(--muted-foreground)]">
                  Project
                </label>
                <Combobox
                  id="dashboard-project"
                  className="w-56 max-md:flex-1"
                  value={projectId}
                  onChange={chooseProject}
                  placeholder="All projects"
                  options={[{ value: '', label: 'All projects' }, ...projects.map((p) => ({ value: p.id, label: p.name }))]}
                />
              </div>
            ) : null}
            <DashboardSwitcher />
          </>
        }
      />

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

      {/* Row 1: four equal KPI cards -> 2x2 on tablet -> stacked on phones. */}
      <section aria-label="Key metrics" className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-4">
        {summaryQuery.isLoading && Array.from({ length: 4 }).map((_, i) => <KpiCardSkeleton key={i} />)}
        {summaryQuery.isError && (
          <EmbossedCard className="sm:col-span-2 lg:col-span-4">
            <CardContent>
              <ErrorState error={summaryQuery.error} onRetry={() => summaryQuery.refetch()} />
            </CardContent>
          </EmbossedCard>
        )}
        {kpis.map((kpi, i) => (
          <KpiCard key={kpi.label} {...kpi} index={i} />
        ))}
      </section>

      {/* Row 2: execution trend (2/3) + test case status (1/3). Hidden for roles denied the report endpoints. */}
      {!reportsHidden && (
        <Section>
          <ChartPanel
            className="md:col-span-7 lg:col-span-8"
            title="Execution trend"
            actions={<RangeControl label="Trend range" value={trendDays} options={TREND_RANGES} onChange={setTrendDays} />}
            summary={
              trendPoints.length > 0
                ? `Line chart of test step results over the last ${trendDays} days: ${passTotal} passed and ${failTotal} failed.`
                : undefined
            }
            table={
              trendPoints.length > 0
                ? {
                    columns: ['Date', 'Pass', 'Fail'],
                    rows: trendPoints.map((p) => [longDay(p.date), p.pass_count, p.fail_count]),
                  }
                : undefined
            }
          >
            {trendQuery.isLoading ? (
              <ChartSkeleton />
            ) : trendQuery.isError ? (
              <ErrorState error={trendQuery.error} onRetry={() => trendQuery.refetch()} />
            ) : trendPoints.length === 0 ? (
              <EmptyState
                title="No execution activity yet"
                description="Run a test to see pass/fail trends here."
                action={startRunAction}
              />
            ) : (
              <div className="flex h-full flex-col gap-2">
                <div className="min-h-0 flex-1">
                  <Suspense fallback={<ChartSkeleton />}>
                    <TrendLineChart
                      points={trendPoints}
                      passColor={passColor}
                      failColor={failColor}
                      reduceMotion={reduceMotion}
                    />
                  </Suspense>
                </div>
                <ChartLegend
                  items={[
                    { label: 'Pass', color: passColor, value: passTotal.toLocaleString() },
                    { label: 'Fail', color: failColor, value: failTotal.toLocaleString() },
                  ]}
                />
              </div>
            )}
          </ChartPanel>

          <ChartPanel
            className="md:col-span-5 lg:col-span-4"
            title="Test case status"
            summary={
              statusPieData.length > 0
                ? `Donut chart of ${statusTotal} test cases: ${statusPieData.map((d) => `${d.count} ${d.status}`).join(', ')}.`
                : undefined
            }
            table={
              statusPieData.length > 0
                ? {
                    columns: ['Status', 'Test cases', 'Share'],
                    rows: statusPieData.map((d) => [d.status, d.count, formatPercent(d.count / statusTotal)]),
                  }
                : undefined
            }
          >
            {statusQuery.isLoading ? (
              <ChartSkeleton />
            ) : statusQuery.isError ? (
              <ErrorState error={statusQuery.error} onRetry={() => statusQuery.refetch()} />
            ) : statusPieData.length === 0 ? (
              <EmptyState title="No test cases yet" description="Create your first test case to see a status breakdown here." />
            ) : (
              <div className="flex h-full flex-col gap-2">
                <div className="relative min-h-0 flex-1">
                  <Suspense fallback={<ChartSkeleton />}>
                    <StatusDonutChart data={statusPieData} reduceMotion={reduceMotion} />
                  </Suspense>
                  <div
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center"
                  >
                    <span className="text-xl font-semibold tabular-nums leading-none">{statusTotal}</span>
                    <span className="text-[11px] text-[var(--muted-foreground)]">test cases</span>
                  </div>
                </div>
                <ChartLegend
                  items={statusPieData.map((d) => ({
                    label: d.status,
                    color: d.color,
                    value: `${d.count} · ${formatPercent(d.count / statusTotal)}`,
                  }))}
                />
              </div>
            )}
          </ChartPanel>
        </Section>
      )}

      {/* Row 3: needs attention + recent activity. */}
      <Section>
        <EmbossedCard className="md:col-span-12 lg:col-span-6">
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle className="flex items-center gap-1.5">
              <AlertTriangle className="size-3.5 text-[var(--status-warning)]" aria-hidden="true" />
              Needs attention
            </CardTitle>
            <Link to="/defects" className="inline-flex text-xs text-[var(--link)] hover:underline max-md:min-h-11 max-md:items-center max-md:text-sm">
              All defects →
            </Link>
          </CardHeader>
          <CardContent>
            {(defectsQuery.isLoading || runsQuery.isLoading) && (
              <div className="flex flex-col gap-2">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="h-9 w-full" />
                ))}
              </div>
            )}
            {defectsQuery.isError && <ErrorState error={defectsQuery.error} onRetry={() => defectsQuery.refetch()} />}
            {!defectsQuery.isLoading && !runsQuery.isLoading && !defectsQuery.isError && attention.length === 0 && (
              <EmptyState
                title="Nothing needs attention"
                description="No open Critical or High defects and no paused runs right now."
              />
            )}
            <ul className="flex flex-col gap-2">
              {attentionShown.map((item) => (
                <li key={`${item.kind}-${item.id}`}>
                  <Link
                    to={item.href}
                    className="flex items-center justify-between gap-3 rounded-md border border-[var(--border)] px-3 py-2 text-sm transition-colors hover:bg-[var(--muted)] max-md:min-h-11"
                  >
                    <span className="min-w-0 truncate">{item.title}</span>
                    <Badge tone={item.kind === 'defect' ? levelTone(item.badge) : 'warning'} className="shrink-0">
                      {item.badge}
                    </Badge>
                  </Link>
                </li>
              ))}
            </ul>
            {attention.length > attentionShown.length && (
              <p className="mt-2 text-xs text-[var(--muted-foreground)]">
                Showing {attentionShown.length} of {attention.length} items.
              </p>
            )}
          </CardContent>
        </EmbossedCard>

        <EmbossedCard className="md:col-span-12 lg:col-span-6">
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle>Recent activity</CardTitle>
            {canSeeAudit && (
              <Link to="/admin/audit-logs" className="inline-flex text-xs text-[var(--link)] hover:underline max-md:min-h-11 max-md:items-center max-md:text-sm">
                View all →
              </Link>
            )}
          </CardHeader>
          <CardContent>
            {activityQuery.isLoading && (
              <div className="flex flex-col gap-2">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-8 w-full" />
                ))}
              </div>
            )}
            {activityQuery.isError && <ErrorState error={activityQuery.error} onRetry={() => activityQuery.refetch()} />}
            {!activityQuery.isLoading && !activityQuery.isError && activity.length === 0 && (
              <EmptyState title="No activity yet" description="Actions across the tenant will show up here." />
            )}
            <ul className="flex flex-col gap-1 text-sm">
              {activityShown.map((entry, i) => {
                const entityRoute = ENTITY_ROUTES[entry.entity_type]
                const body = (
                  <span className="min-w-0 break-words">
                    <span className="font-medium">{entry.user_name ?? 'System'}</span>{' '}
                    <span className="text-[var(--muted-foreground)]">{humanizeActionCode(entry.action)}</span>
                  </span>
                )
                return (
                  <li key={i} className="flex items-center gap-3 border-b border-[var(--border)] py-1.5 last:border-0">
                    <span
                      aria-hidden="true"
                      className="flex size-7 shrink-0 items-center justify-center rounded-full bg-[var(--muted)] text-[11px] font-medium"
                    >
                      {initialsOf(entry.user_name)}
                    </span>
                    {entityRoute ? (
                      <Link
                        to={`${entityRoute}/${entry.entity_id}`}
                        className="min-w-0 flex-1 hover:underline max-md:inline-flex max-md:min-h-11 max-md:items-center"
                      >
                        {body}
                      </Link>
                    ) : (
                      <span className="min-w-0 flex-1">{body}</span>
                    )}
                    <time
                      dateTime={entry.created_at}
                      title={new Date(entry.created_at).toLocaleString()}
                      className="shrink-0 text-xs text-[var(--muted-foreground)]"
                    >
                      {relativeTime(entry.created_at)}
                    </time>
                  </li>
                )
              })}
            </ul>
          </CardContent>
        </EmbossedCard>
      </Section>
    </div>
  )
}
