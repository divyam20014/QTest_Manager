import { lazy, Suspense, useState, type ReactNode } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { AlertTriangle, Check, X } from 'lucide-react'
import { Link, useSearchParams } from 'react-router-dom'

import { fetchActivityStream, fetchAggregateReport, fetchDashboardSummary, fetchExecutionTrend } from '@/api/reporting'
import { listDefects, type Severity } from '@/api/defects'
import { listProjects } from '@/api/projects'
import { Badge } from '@/components/ui/badge'
import { ChartLegend, ChartPanel, RangeControl } from '@/components/ui/ChartPanel'
import { PageHeader } from '@/components/ui/PageHeader'
import { CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { EmbossedCard } from '@/components/ui/EmbossedCard'
import { EmptyState, ErrorState } from '@/components/ui/empty-state'
import { GaugeDial } from '@/components/ui/GaugeDial'
import { Select } from '@/components/ui/select'
import { DashboardSwitcher } from '@/routes/dashboards/DashboardSwitcher'
import { ChartSkeleton, Skeleton } from '@/components/ui/skeleton'
import { TactileButton } from '@/components/ui/TactileButton'
import { humanizeActionCode } from '@/lib/labels'
import { longDay } from '@/routes/dashboardFormat'
import { useAuth } from '@/lib/auth'
import { levelTone } from '@/lib/statusTones'
import { usePrefersReducedMotion } from '@/lib/useMediaQuery'
import { useThemePreference } from '@/lib/useThemePreference'
import { cn } from '@/lib/utils'
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

function severityDetail(openBySeverity: Record<string, number>): string {
  return Object.entries(openBySeverity)
    .sort(([a], [b]) => (SEVERITY_RANK[a as Severity] ?? 99) - (SEVERITY_RANK[b as Severity] ?? 99))
    .map(([s, n]) => `${s}: ${n}`)
    .join(' · ')
}

interface Kpi {
  title: string
  value: string | number
  detail: string
  href: string
  /** A second, independent destination (e.g. "6 critical") kept as its own link. */
  secondary?: { label: string; href: string; tone?: 'critical' }
}

// One tile = one stretched primary link (the title) plus an optional second
// link. A real nested <a> inside an <a> is invalid, so the primary link's
// ::after covers the card and the secondary link sits above it (z-10).
function KpiTile({ kpi, index }: { kpi: Kpi; index: number }) {
  return (
    <EmbossedCard
      interactive
      className={cn('qth-animate-in relative h-full')}
      style={{ animation: `qth-slide-in 0.25s ease-out ${index * 30}ms backwards` }}
    >
      <CardHeader className="p-0">
        <CardTitle>
          <Link
            to={kpi.href}
            className="after:absolute after:inset-0 after:rounded-xl focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:outline-offset-2 focus-visible:after:outline-[var(--ring)]"
          >
            {kpi.title}
          </Link>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-1 p-0">
        <p className="text-3xl font-semibold tabular-nums">{kpi.value}</p>
        <p className="text-xs text-[var(--muted-foreground)]">{kpi.detail}</p>
        {kpi.secondary && (
          <Link
            to={kpi.secondary.href}
            className={cn(
              'relative z-10 mt-1 inline-flex w-fit items-center rounded-[var(--card-inner-radius)] text-xs font-medium hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)] max-md:min-h-11 max-md:text-sm',
              kpi.secondary.tone === 'critical' ? 'text-[var(--status-serious)]' : 'text-[var(--link)]',
            )}
          >
            {kpi.secondary.label} →
          </Link>
        )}
      </CardContent>
    </EmbossedCard>
  )
}

// The skeleton reserves the loaded height of the headline row (measured: hero
// 290/320px, tiles 192/156/178px at phone/tablet/desktop) so the sections below
// do not jump down when the summary arrives.
function KpiSkeleton() {
  return (
    <EmbossedCard className="min-h-[192px] sm:min-h-[156px] lg:min-h-[178px]">
      <CardHeader>
        <Skeleton className="h-4 w-24" />
      </CardHeader>
      <CardContent>
        <Skeleton className="h-8 w-14" />
        <Skeleton className="mt-2 h-3 w-24" />
        <Skeleton className="mt-3 h-3 w-16" />
      </CardContent>
    </EmbossedCard>
  )
}

function Section({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">{children}</div>
}

export function Dashboard() {
  const [theme] = useThemePreference()
  const reduceMotion = usePrefersReducedMotion()
  // The app's light/dark toggle (data-theme) is the source of truth -- the
  // OS media query alone gave a light chart palette on a dark surface
  // whenever the two disagreed.
  const isDark = theme === 'dark'
  const [trendDays, setTrendDays] = useState(30)
  const [showAllActivity, setShowAllActivity] = useState(false)
  const [onboardingDismissed, setOnboardingDismissed] = useState(() => {
    try {
      return localStorage.getItem(ONBOARDING_DISMISSED_KEY) === '1'
    } catch {
      return false
    }
  })
  // One retry (not the default three with back-off) so a failing API shows the
  // error state with its Retry button within ~2s instead of ~7s of skeletons.
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
  // ADR-093: Testers may be denied the report endpoints; those two widgets are then hidden.
  const reportsHidden = !!useAuth().user?.reports_hidden
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
  const needsAttentionShown = needsAttention.slice(0, 6)

  const statusTotals = new Map<string, number>()
  for (const row of statusQuery.data?.rows ?? []) {
    statusTotals.set(row.value, (statusTotals.get(row.value) ?? 0) + row.count)
  }
  const statusPieData = [...statusTotals.entries()]
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
  const statusTotal = statusPieData.reduce((sum, d) => sum + d.count, 0)

  const trendPoints = trendQuery.data?.points ?? []
  const passTotal = trendPoints.reduce((sum, p) => sum + p.pass_count, 0)
  const failTotal = trendPoints.reduce((sum, p) => sum + p.fail_count, 0)
  const passColor = categoricalColor(2, isDark)
  const failColor = categoricalColor(7, isDark)

  const openDefects = summary ? Object.values(summary.defects.open_by_severity).reduce((a, b) => a + b, 0) : 0
  const kpis: Kpi[] = summary
    ? [
        {
          title: 'Projects',
          value: summary.projects.total,
          detail: Object.entries(summary.projects.by_status).map(([s, n]) => `${s}: ${n}`).join(' · ') || 'No projects yet',
          href: '/projects',
          secondary: { label: `${summary.projects.active} active`, href: '/projects?status=Active' },
        },
        {
          title: 'Test Cases',
          value: summary.test_cases.total,
          detail: `${formatPercent(summary.test_cases.approved_ratio)} approved`,
          // `/test-cases` alone isn't a real route (test cases are always
          // scoped to a project or viewed via the cross-project
          // repository) -- `/test-repository` is that cross-project view.
          href: '/test-repository',
          secondary: { label: `${summary.test_cases.approved_count} approved`, href: '/test-repository?status=approved' },
        },
        {
          title: 'Active Test Runs',
          value: summary.test_runs.active,
          detail: `${formatPassRate(summary.test_runs.step_pass_percentage, summary.test_runs.step_sample_size)} steps passing`,
          href: '/test-runs?status=in_progress',
        },
        {
          title: 'Open Defects',
          value: openDefects,
          detail: severityDetail(summary.defects.open_by_severity) || 'None open',
          href: '/defects',
          secondary:
            summary.defects.critical_count > 0
              ? { label: `${summary.defects.critical_count} critical`, href: '/defects?severity=Critical', tone: 'critical' }
              : undefined,
        },
      ]
    : []

  const activity = activityQuery.data ?? []
  const activityShown = showAllActivity ? activity : activity.slice(0, ACTIVITY_PREVIEW)

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
            <DashboardSwitcher />
            {projects.length > 1 ? (
            <div className="flex items-center gap-2">
              <label htmlFor="dashboard-project" className="text-sm text-[var(--muted-foreground)]">
                Project
              </label>
              <Select
                id="dashboard-project"
                className="w-56 max-md:w-full"
                value={projectId}
                onChange={(e) => chooseProject(e.target.value)}
              >
                <option value="">All projects</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </div>
          ) : null}
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

      {/* Headline first: the pass-rate dial is the hero (two columns by two
          rows on wide screens), four KPI tiles beside / below it. */}
      <section aria-label="Key metrics" className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        {summaryQuery.isLoading && (
          <>
            <EmbossedCard className="col-span-2 min-h-[290px] sm:min-h-[320px] lg:row-span-2 lg:min-h-0">
              <CardHeader>
                <Skeleton className="h-4 w-32" />
              </CardHeader>
              <CardContent className="flex flex-col items-center gap-3">
                <Skeleton className="size-40 rounded-full" />
                <Skeleton className="h-3 w-40" />
              </CardContent>
            </EmbossedCard>
            {Array.from({ length: 4 }).map((_, i) => (
              <KpiSkeleton key={i} />
            ))}
          </>
        )}
        {summaryQuery.isError && (
          <EmbossedCard className="col-span-2 lg:col-span-4">
            <CardContent>
              <ErrorState error={summaryQuery.error} onRetry={() => summaryQuery.refetch()} />
            </CardContent>
          </EmbossedCard>
        )}
        {summary && (
          <EmbossedCard className="qth-animate-in col-span-2 flex flex-col lg:row-span-2">
            <CardHeader>
              <CardTitle>Execution Pass %</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-1 flex-col items-center justify-center gap-1 pb-5 pt-0 lg:pb-8">
              <GaugeDial
                size="lg"
                value={summary.test_runs.step_pass_percentage * 100}
                label="Execution pass rate"
                valueLabel={
                  summary.test_runs.step_sample_size === 0
                    ? 'n/a'
                    : formatPercent(summary.test_runs.step_pass_percentage)
                }
              />
              <p className="text-center text-xs text-[var(--muted-foreground)]">
                {summary.test_runs.step_sample_size === 0
                  ? 'No executed steps yet'
                  : summary.test_runs.step_sample_size < THIN_SAMPLE_THRESHOLD
                    ? `${Math.round(summary.test_runs.step_pass_percentage * summary.test_runs.step_sample_size)} of ${summary.test_runs.step_sample_size} steps passed (small sample, more executions will sharpen this)`
                    : `${Math.round(summary.test_runs.step_pass_percentage * summary.test_runs.step_sample_size).toLocaleString()} of ${summary.test_runs.step_sample_size.toLocaleString()} executed steps passed`}
              </p>
            </CardContent>
          </EmbossedCard>
        )}
        {kpis.map((kpi, i) => (
          <KpiTile key={kpi.title} kpi={kpi} index={i + 1} />
        ))}
      </section>

      <Section>
        <EmbossedCard>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle className="flex items-center gap-1.5">
              <AlertTriangle className="size-3.5 text-[var(--status-warning)]" />
              Needs Attention
            </CardTitle>
            <Link to="/defects" className="inline-flex text-xs text-[var(--link)] hover:underline max-md:min-h-11 max-md:items-center max-md:text-sm">
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
              {needsAttentionShown.map((d) => (
                <li key={d.id}>
                  <Link
                    to={`/defects/${d.id}`}
                    className="flex items-center justify-between gap-3 rounded-md border border-[var(--border)] px-3 py-2 text-sm transition-colors hover:bg-[var(--muted)] max-md:min-h-11"
                  >
                    <span className="min-w-0 truncate">{d.title}</span>
                    <Badge tone={levelTone(d.severity)} className="shrink-0">
                      {d.severity}
                    </Badge>
                  </Link>
                </li>
              ))}
            </ul>
            {needsAttention.length > needsAttentionShown.length && (
              <p className="mt-2 text-xs text-[var(--muted-foreground)]">
                Showing {needsAttentionShown.length} of {needsAttention.length} open Critical and High defects.
              </p>
            )}
          </CardContent>
        </EmbossedCard>

        {!reportsHidden && (
        <ChartPanel
          title="Test Case Status"
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
            <ErrorState onRetry={() => statusQuery.refetch()} />
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
        )}

        {!reportsHidden && (
        <ChartPanel
          className="md:col-span-2 lg:col-span-1"
          title="Execution Trend"
          actions={
            <RangeControl label="Trend range" value={trendDays} options={TREND_RANGES} onChange={setTrendDays} />
          }
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
            <ErrorState onRetry={() => trendQuery.refetch()} />
          ) : trendPoints.length === 0 ? (
            <EmptyState title="No execution activity yet" description="Run a test to see pass/fail trends here." />
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
        )}
      </Section>

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
          {!activityQuery.isLoading && !activityQuery.isError && activity.length === 0 && (
            <EmptyState title="No activity yet" description="Actions across the tenant will show up here." />
          )}
          <ul className="flex flex-col gap-2 text-sm">
            {activityShown.map((entry, i) => {
              const entityRoute = ENTITY_ROUTES[entry.entity_type]
              const body = (
                <span>
                  <span className="font-medium">{entry.user_name ?? 'System'}</span>{' '}
                  <span className="text-[var(--muted-foreground)]">{humanizeActionCode(entry.action)}</span>
                </span>
              )
              return (
                <li
                  key={i}
                  className="flex flex-col gap-0.5 border-b border-[var(--border)] pb-2 last:border-0 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
                >
                  {entityRoute ? (
                    <Link
                      to={`${entityRoute}/${entry.entity_id}`}
                      className="min-w-0 break-words hover:underline max-md:inline-flex max-md:min-h-11 max-md:items-center"
                    >
                      {body}
                    </Link>
                  ) : (
                    body
                  )}
                  <span className="flex shrink-0 items-center gap-2 text-xs text-[var(--muted-foreground)]">
                    <Badge tone="neutral">{humanizeActionCode(entry.entity_type)}</Badge>
                    <time dateTime={entry.created_at} title={new Date(entry.created_at).toLocaleString()}>
                      {relativeTime(entry.created_at)}
                    </time>
                  </span>
                </li>
              )
            })}
          </ul>
          {activity.length > ACTIVITY_PREVIEW && (
            <button
              type="button"
              aria-expanded={showAllActivity}
              onClick={() => setShowAllActivity((v) => !v)}
              className="mt-2 inline-flex items-center rounded-md text-sm text-[var(--link)] hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)] max-md:min-h-11"
            >
              {showAllActivity ? 'Show fewer' : `Show all ${activity.length}`}
            </button>
          )}
        </CardContent>
      </EmbossedCard>
    </div>
  )
}
