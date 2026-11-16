import { useState, type ReactNode } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { AlertTriangle, Check, X } from 'lucide-react'
import { Link } from 'react-router-dom'
import {
  CartesianGrid,
  Cell,
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
import { ChartLegend, ChartPanel, RangeControl } from '@/components/ui/ChartPanel'
import { PageHeader } from '@/components/ui/PageHeader'
import { CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { EmbossedCard } from '@/components/ui/EmbossedCard'
import { EmptyState, ErrorState } from '@/components/ui/empty-state'
import { GaugeDial } from '@/components/ui/GaugeDial'
import { ChartSkeleton, Skeleton } from '@/components/ui/skeleton'
import { TactileButton } from '@/components/ui/TactileButton'
import { humanizeActionCode } from '@/lib/labels'
import { levelTone } from '@/lib/statusTones'
import { useThemePreference } from '@/lib/useThemePreference'
import { cn } from '@/lib/utils'
import { categoricalColor } from '@/routes/reporting/palette'

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

const chartTooltipStyle = {
  background: 'var(--tactile-surface-raised)',
  border: 'none',
  borderRadius: 10,
  boxShadow: 'var(--elevation-raised-sm)',
  fontSize: 12,
  color: 'var(--foreground)',
}

// ISO dates ("2026-11-15") parsed as local midnight so the label never
// slips a day in timezones behind UTC.
function parseDay(iso: string): Date {
  return new Date(`${iso}T00:00:00`)
}
function shortDay(iso: string): string {
  return parseDay(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}
function longDay(iso: string): string {
  return parseDay(iso).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
}

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
      className={cn('qth-animate-in relative h-full cursor-pointer', TILE_INTERACTIVE)}
      style={{ animation: `qth-slide-in 0.25s ease-out ${index * 30}ms backwards` }}
    >
      <CardHeader>
        <CardTitle>
          <Link
            to={kpi.href}
            className="after:absolute after:inset-0 after:rounded-xl focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:outline-offset-2 focus-visible:after:outline-[var(--ring)]"
          >
            {kpi.title}
          </Link>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-1">
        <p className="text-3xl font-semibold tabular-nums">{kpi.value}</p>
        <p className="text-xs text-[var(--muted-foreground)]">{kpi.detail}</p>
        {kpi.secondary && (
          <Link
            to={kpi.secondary.href}
            className={cn(
              'relative z-10 mt-1 inline-flex w-fit items-center rounded-md text-xs font-medium hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)] max-md:min-h-11 max-md:text-sm',
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

function KpiSkeleton() {
  return (
    <EmbossedCard>
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
  // The app's light/dark toggle (data-theme) is the source of truth -- the
  // OS media query alone gave a light chart palette on a dark surface
  // whenever the two disagreed.
  const isDark = theme === 'dark'
  const [activePieIndex, setActivePieIndex] = useState<number | null>(null)
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
  const summaryQuery = useQuery({ queryKey: ['dashboard', 'summary'], queryFn: fetchDashboardSummary, retry: 1 })
  const activityQuery = useQuery({ queryKey: ['dashboard', 'activity'], queryFn: fetchActivityStream, retry: 1 })
  const trendQuery = useQuery({
    queryKey: ['dashboard', 'execution-trend', trendDays],
    queryFn: () => fetchExecutionTrend(trendDays),
    placeholderData: keepPreviousData,
    retry: 1,
  })
  const statusQuery = useQuery({
    queryKey: ['dashboard', 'test-case-status'],
    queryFn: () => fetchAggregateReport('test_case_status', 'project'),
    retry: 1,
  })
  const defectsQuery = useQuery({ queryKey: ['dashboard', 'defects-all'], queryFn: () => listDefects(), retry: 1 })

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
      <PageHeader title="Dashboard" description="Current testing status and project health at a glance." />

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
            <EmbossedCard className="col-span-2 lg:row-span-2">
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
              <ErrorState onRetry={() => summaryQuery.refetch()} />
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
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <defs>
                      {statusPieData.map((entry, i) => (
                        // Radial highlight toward the top-left, matching the
                        // app-wide emboss light-source convention -- gives
                        // slices a domed look without introducing any hue
                        // outside the validated categorical palette.
                        <radialGradient key={entry.key} id={`pie-grad-${i}`} cx="35%" cy="30%" r="75%">
                          <stop offset="0%" stopColor={entry.color} stopOpacity={1} />
                          <stop offset="100%" stopColor={entry.color} stopOpacity={0.78} />
                        </radialGradient>
                      ))}
                    </defs>
                    <Tooltip
                      contentStyle={chartTooltipStyle}
                      formatter={(value, name) => [`${value} test case${value === 1 ? '' : 's'}`, name]}
                    />
                    <Pie
                      data={statusPieData}
                      dataKey="count"
                      nameKey="status"
                      innerRadius="58%"
                      outerRadius="92%"
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
                          key={entry.key}
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
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={trendPoints} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                    <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
                    <XAxis
                      dataKey="date"
                      minTickGap={32}
                      tickFormatter={shortDay}
                      tick={{ fontSize: 10, fill: 'var(--chart-axis-text)' }}
                      axisLine={{ stroke: 'var(--chart-axis-line)' }}
                      tickLine={false}
                    />
                    <YAxis
                      allowDecimals={false}
                      tick={{ fontSize: 10, fill: 'var(--chart-axis-text)' }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <Tooltip
                      contentStyle={chartTooltipStyle}
                      labelFormatter={(label) => longDay(String(label))}
                      cursor={{ stroke: 'var(--chart-axis-line)', strokeWidth: 1 }}
                    />
                    <Line
                      type="monotone"
                      dataKey="pass_count"
                      name="Pass"
                      stroke={passColor}
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
                      stroke={failColor}
                      strokeWidth={2.5}
                      dot={false}
                      activeDot={{ r: 5, strokeWidth: 2, style: { filter: 'drop-shadow(0 2px 5px rgba(0, 0, 0, 0.3))' } }}
                      isAnimationActive
                      animationDuration={500}
                    />
                  </LineChart>
                </ResponsiveContainer>
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
