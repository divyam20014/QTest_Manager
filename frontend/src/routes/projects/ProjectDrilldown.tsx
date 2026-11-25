import { useQuery } from '@tanstack/react-query'
import { lazy, Suspense, type ReactNode } from 'react'
import { Link } from 'react-router-dom'

import { listDefects } from '@/api/defects'
import { fetchAggregateReport } from '@/api/reporting'
import { listTestCases } from '@/api/testCases'
import { CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ChartLegend, ChartPanel } from '@/components/ui/ChartPanel'
import { EmbossedCard } from '@/components/ui/EmbossedCard'
import { EmptyState, ErrorState } from '@/components/ui/empty-state'
import { ChartSkeleton, Skeleton } from '@/components/ui/skeleton'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { useIsMobile, usePrefersReducedMotion } from '@/lib/useMediaQuery'
import { useThemePreference } from '@/lib/useThemePreference'
import { categoricalColor } from '@/routes/reporting/palette'
import { DefectStatusBadge } from '@/routes/defects/DefectStatusBadge'
import { severityTone } from '@/routes/defects/statusDisplay'
import { STATUS_DISPLAY, priorityTone } from '@/routes/testcases/statusDisplay'
import { defectPath, testCasePath } from '@/lib/entityRoutes'

const ProjectRunStatusChart = lazy(() =>
  import('./ProjectRunStatusChart').then((m) => ({ default: m.ProjectRunStatusChart })),
)

// Fixed colour per status (never by rank) using the app's validated
// categorical palette slots, matching the Dashboard (pass = 2, fail = 7).
const RUN_STATUSES: { key: string; label: string; slot: number }[] = [
  { key: 'passed', label: 'Passed', slot: 2 },
  { key: 'failed', label: 'Failed', slot: 7 },
  { key: 'pending', label: 'Pending', slot: 0 },
  { key: 'in_progress', label: 'In progress', slot: 1 },
  { key: 'blocked', label: 'Blocked', slot: 3 },
  { key: 'ignored', label: 'Ignored', slot: 4 },
]

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

/** Phone layout for the two "Recent ..." panels. They sit inside a raised card, so a stack of
 * cards would be heavy for five rows: each entry is a wrapping title with its badges and date
 * underneath, separated by dividers, instead of a four-column table that crams the title. */
function RecentList<T>({
  label,
  rows,
  rowKey,
  href,
  title,
  badges,
  meta,
}: {
  label: string
  rows: T[]
  rowKey: (row: T) => string
  href: (row: T) => string
  title: (row: T) => string
  badges: (row: T) => ReactNode
  meta?: (row: T) => ReactNode
}) {
  return (
    <ul aria-label={label} className="divide-y divide-[var(--border)]">
      {rows.map((row) => (
        <li key={rowKey(row)} className="py-1">
          <Link
            to={href(row)}
            className="flex min-h-11 items-center break-words text-base leading-snug text-[var(--link)] hover:underline"
          >
            {title(row)}
          </Link>
          <div className="mt-1 flex flex-wrap items-center gap-2 pb-2">
            {badges(row)}
            {meta?.(row)}
          </div>
        </li>
      ))}
    </ul>
  )
}


function ListSkeleton() {
  return (
    <div className="flex flex-col gap-2" aria-busy="true">
      {Array.from({ length: 4 }).map((_, i) => (
        <Skeleton key={i} className="h-9 w-full" />
      ))}
    </div>
  )
}

/** Project Detail drilldown (BRD FR-PROJ-05): where this project's executed
 * test cases stand, plus its five newest test cases and defects. Reads
 * existing, permission-checked endpoints only. */
export function ProjectDrilldown({ projectId }: { projectId: string }) {
  const [theme] = useThemePreference()
  const reduceMotion = usePrefersReducedMotion()
  const isDark = theme === 'dark'

  const statusQuery = useQuery({
    queryKey: ['projects', projectId, 'run-status'],
    queryFn: () => fetchAggregateReport('run_status', 'project', { projectId }),
    retry: 1,
  })
  const casesQuery = useQuery({
    queryKey: ['projects', projectId, 'recent-test-cases'],
    queryFn: () => listTestCases(projectId, { sort: '-created_at', page_size: 5 }),
    retry: 1,
  })
  const defectsQuery = useQuery({
    queryKey: ['projects', projectId, 'recent-defects'],
    queryFn: () => listDefects({ project_id: projectId }),
    retry: 1,
  })

  const counts = new Map<string, number>()
  for (const row of statusQuery.data?.rows ?? []) {
    counts.set(row.value, (counts.get(row.value) ?? 0) + row.count)
  }
  const bars = RUN_STATUSES.map((s) => ({
    key: s.key,
    label: s.label,
    count: counts.get(s.key) ?? 0,
    color: categoricalColor(s.slot, isDark),
  }))
  const total = bars.reduce((sum, b) => sum + b.count, 0)
  const recentDefects = (defectsQuery.data ?? []).slice(0, 5)
  const isMobile = useIsMobile()
  const recentCases = casesQuery.data?.items ?? []

  return (
    <>
      <ChartPanel
        title="Test run status"
        bodyClassName="h-64"
        summary={
          total > 0
            ? `Bar chart of this project's test cases across runs: ${bars
                .filter((b) => b.count > 0)
                .map((b) => `${b.count} ${b.label.toLowerCase()}`)
                .join(', ')}.`
            : undefined
        }
        table={
          total > 0
            ? { columns: ['Status', 'Test cases in runs'], rows: bars.map((b) => [b.label, b.count]) }
            : undefined
        }
        footer={
          total > 0 ? (
            <ChartLegend
              className="mt-3"
              items={bars.map((b) => ({ label: b.label, color: b.color, value: String(b.count) }))}
            />
          ) : undefined
        }
      >
        {statusQuery.isLoading ? (
          <ChartSkeleton />
        ) : statusQuery.isError ? (
          <ErrorState error={statusQuery.error} onRetry={() => statusQuery.refetch()} message="Could not load run results." />
        ) : total === 0 ? (
          <EmptyState
            title="No test runs yet"
            description="Create a test run for this project to see how its test cases are doing."
          />
        ) : (
          <Suspense fallback={<ChartSkeleton />}>
            <ProjectRunStatusChart data={bars} reduceMotion={reduceMotion} />
          </Suspense>
        )}
      </ChartPanel>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <EmbossedCard>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle>Recent test cases</CardTitle>
            <Link
              to={`/projects/${projectId}/test-cases`}
              className="inline-flex items-center text-xs text-[var(--link)] hover:underline max-md:min-h-11 max-md:text-sm"
            >
              View all
            </Link>
          </CardHeader>
          <CardContent>
            {casesQuery.isLoading ? (
              <ListSkeleton />
            ) : casesQuery.isError ? (
              <ErrorState error={casesQuery.error} onRetry={() => casesQuery.refetch()} message="Could not load test cases." />
            ) : recentCases.length === 0 ? (
              <EmptyState title="No test cases yet" description="Test cases added to this project appear here." />
            ) : isMobile ? (
              <RecentList
                label="Five most recently created test cases"
                rows={recentCases}
                rowKey={(tc) => tc.id}
                href={(tc) => testCasePath(tc.project_id, tc.id)}
                title={(tc) => tc.title}
                badges={(tc) => (
                  <>
                    <StatusBadge tone={priorityTone(tc.priority)}>{tc.priority}</StatusBadge>
                    <StatusBadge tone={STATUS_DISPLAY[tc.status]?.tone ?? 'neutral'}>
                      {tc.status_label ?? STATUS_DISPLAY[tc.status]?.label ?? tc.status}
                    </StatusBadge>
                  </>
                )}
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <caption className="sr-only">Five most recently created test cases</caption>
                  <thead>
                    <tr className="text-xs text-[var(--muted-foreground)]">
                      <th scope="col" className="px-2 py-1.5 font-medium">Title</th>
                      <th scope="col" className="px-2 py-1.5 font-medium">Priority</th>
                      <th scope="col" className="px-2 py-1.5 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentCases.map((tc) => (
                      <tr key={tc.id} className="border-t border-[var(--border)]">
                        <th scope="row" className="max-w-0 px-2 py-1.5 font-normal">
                          <Link
                            to={testCasePath(tc.project_id, tc.id)}
                            className="line-clamp-2 break-words text-[var(--link)] hover:underline max-md:inline-flex max-md:min-h-11 max-md:items-center"
                          >
                            {tc.title}
                          </Link>
                        </th>
                        <td className="px-2 py-1.5">
                          <StatusBadge tone={priorityTone(tc.priority)}>{tc.priority}</StatusBadge>
                        </td>
                        <td className="px-2 py-1.5">
                          <StatusBadge tone={STATUS_DISPLAY[tc.status]?.tone ?? 'neutral'}>
                            {tc.status_label ?? STATUS_DISPLAY[tc.status]?.label ?? tc.status}
                          </StatusBadge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </EmbossedCard>

        <EmbossedCard>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle>Recent defects</CardTitle>
            <Link
              to={`/defects?projectId=${projectId}`}
              className="inline-flex items-center text-xs text-[var(--link)] hover:underline max-md:min-h-11 max-md:text-sm"
            >
              View all
            </Link>
          </CardHeader>
          <CardContent>
            {defectsQuery.isLoading ? (
              <ListSkeleton />
            ) : defectsQuery.isError ? (
              <ErrorState error={defectsQuery.error} onRetry={() => defectsQuery.refetch()} message="Could not load defects." />
            ) : recentDefects.length === 0 ? (
              <EmptyState title="No defects yet" description="Defects reported against this project appear here." />
            ) : isMobile ? (
              <RecentList
                label="Five most recently reported defects"
                rows={recentDefects}
                rowKey={(d) => d.id}
                href={(d) => defectPath(d.project_id, d.id)}
                title={(d) => d.title}
                badges={(d) => (
                  <>
                    <StatusBadge tone={severityTone(d.severity)}>{d.severity}</StatusBadge>
                    <DefectStatusBadge status={d.status} label={d.status_label} />
                  </>
                )}
                meta={(d) => (
                  <span className="text-xs text-[var(--muted-foreground)]">{formatDate(d.created_at)}</span>
                )}
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <caption className="sr-only">Five most recently reported defects</caption>
                  <thead>
                    <tr className="text-xs text-[var(--muted-foreground)]">
                      <th scope="col" className="px-2 py-1.5 font-medium">Title</th>
                      <th scope="col" className="px-2 py-1.5 font-medium">Severity</th>
                      <th scope="col" className="px-2 py-1.5 font-medium">Status</th>
                      <th scope="col" className="px-2 py-1.5 font-medium">Reported</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentDefects.map((d) => (
                      <tr key={d.id} className="border-t border-[var(--border)]">
                        <th scope="row" className="max-w-0 px-2 py-1.5 font-normal">
                          <Link
                            to={defectPath(d.project_id, d.id)}
                            className="line-clamp-2 break-words text-[var(--link)] hover:underline max-md:inline-flex max-md:min-h-11 max-md:items-center"
                          >
                            {d.title}
                          </Link>
                        </th>
                        <td className="px-2 py-1.5">
                          <StatusBadge tone={severityTone(d.severity)}>{d.severity}</StatusBadge>
                        </td>
                        <td className="px-2 py-1.5">
                          <DefectStatusBadge status={d.status} label={d.status_label} />
                        </td>
                        <td className="whitespace-nowrap px-2 py-1.5 text-xs text-[var(--muted-foreground)]">
                          {formatDate(d.created_at)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </EmbossedCard>
      </div>
    </>
  )
}
