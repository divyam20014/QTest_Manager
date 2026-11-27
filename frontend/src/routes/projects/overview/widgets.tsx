import { Suspense, lazy, type ReactNode } from 'react'
import { Link } from 'react-router-dom'

import { listDefectsPage } from '@/api/defects'
import { listMyRunCases } from '@/api/myWork'
import {
  fetchModuleCoverage,
  fetchOverdueRunCases,
  fetchProjectTestStatus,
  fetchTesterPerformance,
  fetchUpcomingMilestones,
  type ProjectWidgetType,
} from '@/api/projectDashboard'
import {
  fetchActivityStream,
  fetchDashboardSummary,
  fetchExecutionTrend,
  fetchReleaseReadiness,
  fetchWorkloadSummary,
} from '@/api/reporting'
import { getCoverageReport } from '@/api/requirements'
import { getProjectTaskSummary } from '@/api/tasks'
import { ChartLegend, ChartPanel } from '@/components/ui/ChartPanel'
import { ChartSkeleton } from '@/components/ui/skeleton'
import { LevelBadge } from '@/components/ui/LevelBadge'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { dueRelative, formatDueDate } from '@/lib/dueDate'
import { formatWhen } from '@/lib/formatWhen'
import { humanizeKey } from '@/lib/labels'
import {
  defectsLink,
  executionLink,
  percentLabel,
  testCasesLink,
} from '@/lib/projectDashboard'
import { projectActivityPath, projectReleasesPath, tabDef } from '@/lib/projectNav'
import { RUN_CASE_STATUS_TONE } from '@/lib/statusTones'
import { usePrefersReducedMotion } from '@/lib/useMediaQuery'
import { useThemePreference } from '@/lib/useThemePreference'
import { DefectStatusBadge } from '@/routes/defects/DefectStatusBadge'
import { severityTone } from '@/routes/defects/statusDisplay'
import { categoricalColor } from '@/routes/reporting/palette'

import { KpiStrip } from './KpiStrip'
import { Async, BarRows, Note, Tile, ViewLink, WidgetFrame, useOverviewQuery } from './shared'
import { defectPath, testRunPath } from '@/lib/entityRoutes'

const TrendLineChart = lazy(() => import('@/routes/dashboardCharts').then((m) => ({ default: m.TrendLineChart })))

const SEVERITY_ORDER = ['Critical', 'High', 'Medium', 'Low']
const sevRank = (s: string) => {
  const i = SEVERITY_ORDER.indexOf(s)
  return i === -1 ? 99 : i
}

const tabTo = (key: Parameters<typeof tabDef>[0], projectId: string) => tabDef(key)!.to(projectId)

type WidgetProps = { projectId: string }

// --- Pass / fail distribution ----------------------------------------------------------------

const STATUS_PARTS = [
  { key: 'passed', label: 'Pass', filter: 'Pass', color: 'var(--status-good)' },
  { key: 'failed', label: 'Fail', filter: 'Fail', color: 'var(--status-serious)' },
  { key: 'blocked', label: 'Blocked', filter: 'Blocked', color: 'var(--status-warning)' },
  { key: 'skipped', label: 'Skipped', filter: undefined, color: 'var(--status-info)' },
  { key: 'not_run', label: 'Not run', filter: 'Not Run', color: 'var(--status-neutral)' },
] as const

function TestStatusWidget({ projectId }: WidgetProps) {
  const q = useOverviewQuery(projectId, ['test-status'], () => fetchProjectTestStatus(projectId))
  const s = q.data
  const parts = s ? STATUS_PARTS.map((p) => ({ ...p, value: s[p.key] })) : []
  const total = s?.total ?? 0
  return (
    <ChartPanel
      title="Pass / fail distribution"
      className="h-full"
      png={false}
      bodyClassName="min-h-36"
      actions={<ViewLink to={testCasesLink(projectId)} title="Pass / fail distribution" />}
      summary={
        s && total
          ? `Test cases by latest result: ${parts.map((p) => `${p.value} ${p.label}`).join(', ')} of ${total}.`
          : undefined
      }
      table={
        s && total
          ? {
              columns: ['Result', 'Test cases', 'Share'],
              rows: parts.map((p) => [p.label, p.value, `${Math.round((p.value / total) * 1000) / 10}%`]),
            }
          : undefined
      }
    >
      <Async q={q} title="Pass / fail distribution" chart>
        {() =>
          total === 0 ? (
            <Note>No test cases yet.</Note>
          ) : (
            <div className="flex flex-col gap-3">
              <div
                className="flex h-2.5 w-full overflow-hidden rounded-full bg-[var(--muted)]"
                role="img"
                aria-label={`${s!.passed} passed, ${s!.failed} failed, ${s!.blocked} blocked, ${s!.skipped} skipped, ${s!.not_run} not run`}
              >
                {parts
                  .filter((p) => p.value > 0)
                  .map((p) => (
                    <span key={p.key} style={{ width: `${(p.value / total) * 100}%`, background: p.color }} />
                  ))}
              </div>
              <ul className="flex flex-col gap-1 text-xs">
                {parts.map((p) => (
                  <li key={p.key} className="flex items-center justify-between gap-2">
                    <span className="flex min-w-0 items-center gap-1.5">
                      <span aria-hidden="true" className="size-2 shrink-0 rounded-full" style={{ background: p.color }} />
                      {p.filter ? (
                        <Link
                          to={testCasesLink(projectId, { executionStatus: p.filter })}
                          className="inline-flex items-center truncate hover:underline focus-visible:outline-2 focus-visible:outline-[var(--ring)] max-md:min-h-11 max-md:min-w-11"
                        >
                          {p.label}
                        </Link>
                      ) : (
                        <span className="truncate">{p.label}</span>
                      )}
                    </span>
                    <span className="tabular-nums">
                      <span className="font-medium">{p.value}</span>{' '}
                      <span className="text-[var(--muted-foreground)]">
                        {Math.round((p.value / total) * 1000) / 10}%
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
              {s!.executed > 0 && (
                <p className="text-xs text-[var(--muted-foreground)]">
                  Case pass rate {percentLabel(s!.pass_rate)} of {s!.executed} executed
                </p>
              )}
            </div>
          )
        }
      </Async>
    </ChartPanel>
  )
}

// --- Execution trend -------------------------------------------------------------------------

function ExecutionTrendWidget({ projectId }: WidgetProps) {
  const [theme] = useThemePreference()
  const dark = theme === 'dark'
  const reduceMotion = usePrefersReducedMotion()
  const q = useOverviewQuery(projectId, ['trend', 30], () => fetchExecutionTrend(30, projectId))
  const points = q.data?.points ?? []
  const pass = points.reduce((n, p) => n + p.pass_count, 0)
  const fail = points.reduce((n, p) => n + p.fail_count, 0)
  const passColor = categoricalColor(2, dark)
  const failColor = categoricalColor(7, dark)
  const title = 'Test execution trend (30 days)'
  return (
    <ChartPanel
      title={title}
      className="h-full"
      bodyClassName="h-40"
      actions={<ViewLink to={tabTo('reports', projectId)} title={title} />}
      summary={points.length ? `Line chart, last 30 days: ${pass} step passes and ${fail} failures.` : undefined}
      table={
        points.length
          ? { columns: ['Date', 'Pass', 'Fail'], rows: points.map((p) => [p.date, p.pass_count, p.fail_count]) }
          : undefined
      }
    >
      <Async q={q} title={title} chart>
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
            <Note>No test steps were executed in the last 30 days.</Note>
          )
        }
      </Async>
    </ChartPanel>
  )
}

// --- Defect severity -------------------------------------------------------------------------

function DefectSeverityWidget({ projectId }: WidgetProps) {
  const [theme] = useThemePreference()
  const q = useOverviewQuery(projectId, ['summary'], () => fetchDashboardSummary(projectId))
  const sev = Object.entries(q.data?.defects.open_by_severity ?? {}).sort(([a], [b]) => sevRank(a) - sevRank(b))
  const title = 'Defect severity'
  return (
    <ChartPanel
      title={title}
      className="h-full"
      png={false}
      bodyClassName="min-h-28"
      actions={<ViewLink to={defectsLink(projectId, { open: true })} title={title} />}
      summary={q.data ? `Open defects by severity: ${sev.map(([s, n]) => `${n} ${s}`).join(', ') || 'none'}.` : undefined}
      table={q.data ? { columns: ['Severity', 'Open defects'], rows: sev.map(([s, n]) => [s, n]) } : undefined}
    >
      <Async q={q} title={title} chart>
        {() =>
          sev.length ? (
            <BarRows
              unit="Open defects by severity"
              rows={sev.map(([label, value], i) => ({
                label,
                value,
                color: categoricalColor(i, theme === 'dark'),
                to: defectsLink(projectId, { open: true, severity: label }),
              }))}
            />
          ) : (
            <Note>No open defects.</Note>
          )
        }
      </Async>
    </ChartPanel>
  )
}

// --- Module coverage -------------------------------------------------------------------------

const MODULE_ROWS = 8

function ModuleCoverageWidget({ projectId }: WidgetProps) {
  const [theme] = useThemePreference()
  const q = useOverviewQuery(projectId, ['module-coverage'], () => fetchModuleCoverage(projectId))
  const rows = q.data?.rows ?? []
  const title = 'Module-wise coverage'
  return (
    <ChartPanel
      title={title}
      className="h-full"
      png={false}
      bodyClassName="min-h-28"
      actions={<ViewLink to={testCasesLink(projectId)} title={title} />}
      summary={
        rows.length
          ? `Coverage by module: ${rows.map((r) => `${r.module_name} ${r.executed} of ${r.total} executed`).join(', ')}.`
          : undefined
      }
      table={
        rows.length
          ? {
              columns: ['Module', 'Test cases', 'Executed', 'Passed', 'Coverage'],
              rows: rows.map((r) => [r.module_name, r.total, r.executed, r.passed, percentLabel(r.coverage_percentage)]),
            }
          : undefined
      }
    >
      <Async q={q} title={title} chart>
        {() =>
          rows.length ? (
            <div className="flex flex-col gap-2">
              <BarRows
                unit="Executed share of each module's test cases"
                max={100}
                rows={rows.slice(0, MODULE_ROWS).map((r, i) => ({
                  label: r.module_name,
                  value: r.coverage_percentage ?? 0,
                  display: `${r.executed}/${r.total}`,
                  color: categoricalColor(i, theme === 'dark'),
                  to: r.module_id ? testCasesLink(projectId, { moduleId: r.module_id }) : undefined,
                }))}
              />
              <p className="text-xs text-[var(--muted-foreground)]">
                Executed of total test cases per module
                {rows.length > MODULE_ROWS ? `; top ${MODULE_ROWS} of ${rows.length} modules` : ''}.
              </p>
            </div>
          ) : (
            <Note>No test cases yet.</Note>
          )
        }
      </Async>
    </ChartPanel>
  )
}

// --- Requirement traceability ----------------------------------------------------------------

function RequirementTraceabilityWidget({ projectId }: WidgetProps) {
  const q = useOverviewQuery(projectId, ['coverage'], () => getCoverageReport(projectId, true))
  const title = 'Requirement traceability'
  return (
    <WidgetFrame testId="widget-requirement_traceability" title={title} view={{ to: `/projects/${projectId}/traceability-matrix` }}>
      <Async q={q} title={title}>
        {(r) =>
          r.total_requirements === 0 ? (
            <Note>No requirements yet.</Note>
          ) : (
            <div className="flex flex-col gap-2">
              <p className="text-2xl font-semibold tabular-nums">
                {r.covered_requirements}
                <span className="text-base font-normal text-[var(--muted-foreground)]"> of {r.total_requirements}</span>
              </p>
              <span
                role="progressbar"
                aria-label="Requirements with a linked test case"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(r.coverage_percentage)}
                className="h-2 overflow-hidden rounded-full bg-[var(--muted)]"
              >
                <span className="block h-full bg-[var(--primary)]" style={{ width: `${r.coverage_percentage}%` }} />
              </span>
              <p className="text-xs text-[var(--muted-foreground)]">
                {percentLabel(r.coverage_percentage)} covered by a test case.{' '}
                {r.total_requirements - r.covered_requirements > 0 &&
                  `${r.total_requirements - r.covered_requirements} without one.`}
              </p>
            </div>
          )
        }
      </Async>
    </WidgetFrame>
  )
}

// --- Task progress ---------------------------------------------------------------------------

function TaskProgressWidget({ projectId }: WidgetProps) {
  const q = useOverviewQuery(projectId, ['task-summary'], () => getProjectTaskSummary(projectId))
  const title = 'Task progress'
  const tasksTo = tabTo('tasks', projectId)
  return (
    <WidgetFrame testId="widget-task_progress" title={title} view={{ to: tasksTo }}>
      <Async q={q} title={title}>
        {(s) =>
          s.total === 0 ? (
            <Note>No tasks yet.</Note>
          ) : (
            <div className="flex flex-col gap-3">
              <p className="text-2xl font-semibold tabular-nums">
                {s.done}
                <span className="text-base font-normal text-[var(--muted-foreground)]"> of {s.total} done</span>
              </p>
              <span
                role="progressbar"
                aria-label="Tasks done"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={s.progress_percent}
                className="h-2 overflow-hidden rounded-full bg-[var(--muted)]"
              >
                <span className="block h-full bg-[var(--primary)]" style={{ width: `${s.progress_percent}%` }} />
              </span>
              <BarRows
                unit="Tasks by status"
                max={Math.max(1, s.total)}
                rows={s.by_status.map((st) => ({
                  label: st.label,
                  value: st.count,
                  color: st.color ?? 'var(--primary)',
                  to: `${tasksTo}?status=${st.status_id}`,
                }))}
              />
              <div className="grid grid-cols-3 gap-2">
                <Tile label="Overdue" value={String(s.overdue)} />
                <Tile label="Due in 7 days" value={String(s.due_next_7_days)} />
                <Tile label="Unassigned" value={String(s.unassigned_open)} />
              </div>
              <p className="text-xs text-[var(--muted-foreground)]">
                {s.top_level} top-level task{s.top_level === 1 ? '' : 's'} and {s.sub_tasks} sub-task
                {s.sub_tasks === 1 ? '' : 's'}; {s.completed_last_7_days} finished in the last 7 days.
              </p>
            </div>
          )
        }
      </Async>
    </WidgetFrame>
  )
}

// --- Tester performance ----------------------------------------------------------------------

const TH = 'px-2 py-1 text-left text-xs font-medium text-[var(--muted-foreground)]'
const TD = 'px-2 py-1.5 text-sm tabular-nums'

function TesterPerformanceWidget({ projectId }: WidgetProps) {
  const q = useOverviewQuery(projectId, ['tester-performance'], () => fetchTesterPerformance(projectId))
  const rows = q.data?.rows ?? []
  const title = 'Tester performance'
  return (
    <ChartPanel
      title={title}
      className="h-full"
      png={false}
      bodyClassName="min-h-28"
      actions={<ViewLink to={testCasesLink(projectId)} title={title} />}
      summary={
        rows.length
          ? `Tester performance: ${rows.map((r) => `${r.user_name ?? 'Unknown'} ${r.executed} executed`).join(', ')}.`
          : undefined
      }
      table={
        rows.length
          ? {
              columns: ['Tester', 'Executed', 'Pass rate', 'Defects raised'],
              rows: rows.map((r) => [r.user_name ?? 'Unknown', r.executed, percentLabel(r.pass_rate), r.defects_raised]),
            }
          : undefined
      }
    >
      <Async q={q} title={title} chart>
        {() =>
          rows.length ? (
            <table className="w-full">
              <caption className="sr-only">Executed test cases, pass rate and defects raised per tester</caption>
              <thead>
                <tr>
                  <th scope="col" className={TH}>
                    Tester
                  </th>
                  <th scope="col" className={`${TH} text-right`}>
                    Executed
                  </th>
                  <th scope="col" className={`${TH} text-right`}>
                    Pass rate
                  </th>
                  <th scope="col" className={`${TH} text-right`}>
                    Defects
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 6).map((r) => (
                  <tr key={r.user_id ?? 'unknown'} className="border-t border-[var(--border)]">
                    <th scope="row" className="max-w-[10rem] truncate px-2 py-1.5 text-left text-sm font-normal">
                      {r.user_name ?? 'Unknown user'}
                    </th>
                    <td className={`${TD} text-right`}>
                      {r.user_id && r.executed > 0 ? (
                        <Link
                          to={testCasesLink(projectId, { executedBy: r.user_id })}
                          className="inline-flex items-center hover:underline max-md:min-h-11 max-md:min-w-11 max-md:justify-end"
                          aria-label={`${r.executed} test cases last executed by ${r.user_name ?? 'this user'}`}
                        >
                          {r.executed}
                        </Link>
                      ) : (
                        r.executed
                      )}
                    </td>
                    <td className={`${TD} text-right`}>{percentLabel(r.pass_rate)}</td>
                    <td className={`${TD} text-right`}>
                      {r.user_id && r.defects_raised > 0 ? (
                        <Link
                          to={defectsLink(projectId, { reportedBy: r.user_id })}
                          className="inline-flex items-center hover:underline max-md:min-h-11 max-md:min-w-11 max-md:justify-end"
                          aria-label={`${r.defects_raised} defects raised by ${r.user_name ?? 'this user'}`}
                        >
                          {r.defects_raised}
                        </Link>
                      ) : (
                        r.defects_raised
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <Note>No test case has been executed yet.</Note>
          )
        }
      </Async>
    </ChartPanel>
  )
}

// --- Tester workload -------------------------------------------------------------------------

function TesterWorkloadWidget({ projectId }: WidgetProps) {
  const q = useOverviewQuery(projectId, ['workload'], () => fetchWorkloadSummary(projectId))
  const title = 'Tester workload'
  return (
    <WidgetFrame testId="widget-tester_workload" title={title} view={{ to: tabTo('team', projectId) }}>
      <Async q={q} title={title}>
        {(r) =>
          r.entries.length ? (
            <table className="w-full">
              <caption className="sr-only">Assigned test cases, pending run cases and open defects per person</caption>
              <thead>
                <tr>
                  <th scope="col" className={TH}>
                    Person
                  </th>
                  <th scope="col" className={`${TH} text-right`}>
                    Assigned cases
                  </th>
                  <th scope="col" className={`${TH} text-right`}>
                    Run cases to do
                  </th>
                  <th scope="col" className={`${TH} text-right`}>
                    Open defects
                  </th>
                </tr>
              </thead>
              <tbody>
                {r.entries.slice(0, 6).map((e) => (
                  <tr key={e.user_id} className="border-t border-[var(--border)]">
                    <th scope="row" className="max-w-[10rem] truncate px-2 py-1.5 text-left text-sm font-normal">
                      {e.user_name ?? 'Unknown user'}
                    </th>
                    <td className={`${TD} text-right`}>
                      {e.assigned_test_cases > 0 ? (
                        <Link
                          to={testCasesLink(projectId, { assigneeId: e.user_id })}
                          className="inline-flex items-center hover:underline max-md:min-h-11 max-md:min-w-11 max-md:justify-end"
                          aria-label={`${e.assigned_test_cases} test cases assigned to ${e.user_name ?? 'this user'}`}
                        >
                          {e.assigned_test_cases}
                        </Link>
                      ) : (
                        0
                      )}
                    </td>
                    <td className={`${TD} text-right`}>
                      {e.assigned_test_run_cases_pending + e.assigned_test_run_cases_in_progress}
                    </td>
                    <td className={`${TD} text-right`}>
                      {e.defects_reported_open > 0 ? (
                        <Link
                          to={defectsLink(projectId, { open: true, reportedBy: e.user_id })}
                          className="inline-flex items-center hover:underline max-md:min-h-11 max-md:min-w-11 max-md:justify-end"
                          aria-label={`${e.defects_reported_open} open defects reported by ${e.user_name ?? 'this user'}`}
                        >
                          {e.defects_reported_open}
                        </Link>
                      ) : (
                        0
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <Note>Nothing is assigned yet.</Note>
          )
        }
      </Async>
    </WidgetFrame>
  )
}

// --- Release readiness -----------------------------------------------------------------------

function ReleaseReadinessWidget({ projectId }: WidgetProps) {
  // ADR-137: the report covers the whole project, so no release is picked or named.
  const q = useOverviewQuery(projectId, ['readiness'], () => fetchReleaseReadiness(projectId))
  const title = 'Release readiness'
  return (
    <WidgetFrame testId="widget-release_readiness" title={title} view={{ to: projectReleasesPath(projectId) }}>
      <Async q={q} title={title}>
        {(rr) => (
          <div className="flex flex-col gap-2">
            <p className="text-sm font-medium">Whole project, not one release</p>
            <div className="grid grid-cols-2 gap-2">
              <Tile label="Execution complete" value={percentLabel(rr.execution_completion_percentage)} />
              <Tile label="Run case pass rate" value={percentLabel(rr.pass_percentage)} />
              <Tile label="Requirement coverage" value={percentLabel(rr.requirement_coverage_percentage)} />
              <Tile
                label="Open defects"
                value={String(Object.values(rr.open_defects_by_severity).reduce((a, b) => a + b, 0))}
              />
            </div>
          </div>
        )}
      </Async>
    </WidgetFrame>
  )
}

// --- Upcoming milestones ---------------------------------------------------------------------

function UpcomingMilestonesWidget({ projectId }: WidgetProps) {
  const q = useOverviewQuery(projectId, ['milestones'], () => fetchUpcomingMilestones(projectId))
  const title = 'Upcoming milestones'
  return (
    <WidgetFrame testId="widget-upcoming_milestones" title={title} view={{ to: projectReleasesPath(projectId) }}>
      <Async q={q} title={title}>
        {(r) =>
          r.items.length ? (
            <ul className="flex flex-col gap-1.5">
              {r.items.slice(0, 5).map((m) => (
                <li key={`${m.kind}-${m.id}`}>
                  <Link
                    to={m.kind === 'release' ? projectReleasesPath(projectId) : testRunPath(projectId, m.id)}
                    className="flex flex-col rounded-md px-1 py-0.5 text-sm hover:bg-[var(--muted)] focus-visible:outline-2 focus-visible:outline-[var(--ring)]"
                  >
                    <span className="truncate font-medium">{m.name}</span>
                    <span className="truncate text-xs text-[var(--muted-foreground)]">
                      {m.kind === 'release' ? 'Release' : 'Run due'} · {formatDueDate(m.milestone_date)} ·{' '}
                      {dueRelative(m.milestone_date)}
                      {m.kind === 'run_due' && m.detail ? ` · ${m.detail}` : m.detail ? ` · ${m.detail}` : ''}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <Note>No dated releases or run due dates coming up.</Note>
          )
        }
      </Async>
    </WidgetFrame>
  )
}

// --- Overdue test cases ----------------------------------------------------------------------

function OverdueCasesWidget({ projectId }: WidgetProps) {
  const q = useOverviewQuery(projectId, ['overdue'], () => fetchOverdueRunCases(projectId))
  const title = 'Overdue test cases'
  return (
    <WidgetFrame testId="widget-overdue_cases" title={title} view={{ to: executionLink(projectId, true) }}>
      <Async q={q} title={title}>
        {(r) =>
          r.items.length ? (
            <div className="flex flex-col gap-1.5">
              <p className="text-xs text-[var(--muted-foreground)]" data-testid="overdue-total" data-value={r.total}>
                {r.total} run case{r.total === 1 ? '' : 's'} past due, not yet executed
              </p>
              <ul className="flex flex-col gap-1">
                {r.items.slice(0, 5).map((i) => (
                  <li key={i.run_case_id}>
                    <Link
                      to={`/test-run-cases/${i.run_case_id}?runId=${i.run_id}`}
                      className="flex items-center justify-between gap-2 rounded-md px-1 py-0.5 text-sm hover:bg-[var(--muted)] focus-visible:outline-2 focus-visible:outline-[var(--ring)]"
                    >
                      <span className="flex min-w-0 flex-col">
                        <span className="truncate font-medium">
                          {i.test_case_display_id && (
                            <span className="mr-1.5 font-mono text-xs text-[var(--muted-foreground)]">
                              {i.test_case_display_id}
                            </span>
                          )}
                          {i.title}
                        </span>
                        <span className="truncate text-xs text-[var(--muted-foreground)]">
                          {i.run_name} · {i.assignee_name ?? 'Unassigned'}
                        </span>
                      </span>
                      <StatusBadge tone="critical" title={`Due ${i.due_date}`}>
                        {dueRelative(i.due_date)}
                      </StatusBadge>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <Note>Nothing is overdue. Set a due date when assigning a run case to track it here.</Note>
          )
        }
      </Async>
    </WidgetFrame>
  )
}

// --- Recent defects --------------------------------------------------------------------------

function RecentDefectsWidget({ projectId }: WidgetProps) {
  const q = useOverviewQuery(projectId, ['recent-defects'], () =>
    listDefectsPage({ project_id: projectId, sort: '-created_at', page: 1, page_size: 5 }),
  )
  const title = 'Recently reported defects'
  return (
    <WidgetFrame testId="widget-recent_defects" title={title} view={{ to: defectsLink(projectId) }}>
      <Async q={q} title={title}>
        {(r) =>
          r.items.length ? (
            <ul className="flex flex-col gap-1">
              {r.items.map((d) => (
                <li key={d.id}>
                  <Link
                    to={defectPath(projectId, d.id)}
                    className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-md px-1 py-1 text-sm hover:bg-[var(--muted)] focus-visible:outline-2 focus-visible:outline-[var(--ring)]"
                  >
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate font-medium">
                        {d.display_id && (
                          <span className="mr-1.5 font-mono text-xs text-[var(--muted-foreground)]">{d.display_id}</span>
                        )}
                        {d.title}
                      </span>
                      <span className="truncate text-xs text-[var(--muted-foreground)]">
                        {d.reported_by_name ?? 'Unknown'} · {formatWhen(d.created_at)}
                      </span>
                    </span>
                    <span className="flex shrink-0 items-center gap-3">
                      <LevelBadge tone={severityTone(d.severity)}>{d.severity}</LevelBadge>
                      <DefectStatusBadge status={d.status} label={d.status_label} />
                    </span>
                  </Link>
                </li>
              ))}
              {r.total > r.items.length && (
                <li className="px-1 text-xs text-[var(--muted-foreground)]">
                  Latest {r.items.length} of {r.total} defects.
                </li>
              )}
            </ul>
          ) : (
            <Note>No defects have been reported in this project.</Note>
          )
        }
      </Async>
    </WidgetFrame>
  )
}

// --- My pending activities -------------------------------------------------------------------

function MyPendingWidget({ projectId }: WidgetProps) {
  const q = useOverviewQuery(projectId, ['my-pending'], () => listMyRunCases(projectId))
  const title = 'My pending activities'
  return (
    <WidgetFrame testId="widget-my_pending" title={title} view={{ to: '/my-work' }}>
      <Async q={q} title={title}>
        {(r) =>
          r.items.length ? (
            <ul className="flex flex-col gap-1">
              {r.items.slice(0, 5).map((i) => (
                <li key={i.id}>
                  <Link
                    to={`/test-run-cases/${i.id}?runId=${i.run_id}`}
                    className="flex items-center justify-between gap-2 rounded-md px-1 py-0.5 text-sm hover:bg-[var(--muted)] focus-visible:outline-2 focus-visible:outline-[var(--ring)]"
                  >
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate font-medium">{i.title}</span>
                      <span className="truncate text-xs text-[var(--muted-foreground)]">
                        {i.run_name}
                        {i.due_date ? ` · ${dueRelative(i.due_date)}` : ''}
                      </span>
                    </span>
                    <StatusBadge tone={i.overdue ? 'critical' : RUN_CASE_STATUS_TONE[i.status]}>
                      {i.overdue ? 'Overdue' : humanizeKey(i.status)}
                    </StatusBadge>
                  </Link>
                </li>
              ))}
              {r.total > 5 && <li className="px-1 text-xs text-[var(--muted-foreground)]">Showing 5 of {r.total}.</li>}
            </ul>
          ) : (
            <Note>Nothing is waiting on you in this project.</Note>
          )
        }
      </Async>
    </WidgetFrame>
  )
}

// --- Recent activity -------------------------------------------------------------------------

function RecentActivityWidget({ projectId }: WidgetProps) {
  const q = useOverviewQuery(projectId, ['activity'], () => fetchActivityStream(projectId))
  const title = 'Recent activity'
  return (
    <WidgetFrame testId="widget-recent_activity" title={title} view={{ to: projectActivityPath(projectId) }}>
      <Async q={q} title={title}>
        {(entries) =>
          entries.length ? (
            <ul className="flex flex-col gap-1.5 text-sm">
              {entries.slice(0, 5).map((e, i) => (
                <li key={`${e.entity_id}-${i}`} className="flex flex-col">
                  <span className="break-words">
                    {e.user_name ?? 'Someone'} {e.action.replace(/[._]/g, ' ')}
                  </span>
                  <span className="text-xs text-[var(--muted-foreground)]">
                    {humanizeKey(e.entity_type)} · {formatWhen(e.created_at)}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <Note>No recent activity.</Note>
          )
        }
      </Async>
    </WidgetFrame>
  )
}

export const PROJECT_WIDGETS: Record<ProjectWidgetType, (p: WidgetProps) => ReactNode> = {
  kpi_strip: (p) => <KpiStrip {...p} />,
  test_status: (p) => <TestStatusWidget {...p} />,
  execution_trend: (p) => <ExecutionTrendWidget {...p} />,
  defect_severity: (p) => <DefectSeverityWidget {...p} />,
  module_coverage: (p) => <ModuleCoverageWidget {...p} />,
  requirement_traceability: (p) => <RequirementTraceabilityWidget {...p} />,
  task_progress: (p) => <TaskProgressWidget {...p} />,
  tester_performance: (p) => <TesterPerformanceWidget {...p} />,
  tester_workload: (p) => <TesterWorkloadWidget {...p} />,
  release_readiness: (p) => <ReleaseReadinessWidget {...p} />,
  upcoming_milestones: (p) => <UpcomingMilestonesWidget {...p} />,
  overdue_cases: (p) => <OverdueCasesWidget {...p} />,
  recent_defects: (p) => <RecentDefectsWidget {...p} />,
  my_pending: (p) => <MyPendingWidget {...p} />,
  recent_activity: (p) => <RecentActivityWidget {...p} />,
}
