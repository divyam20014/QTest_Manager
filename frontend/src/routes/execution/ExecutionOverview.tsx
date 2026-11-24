import { useQueries, useQuery } from '@tanstack/react-query'
import { Link, useSearchParams } from 'react-router-dom'

import { listTestRuns, getTestRun, type TestRunCase } from '@/api/execution'
import { listProjects, type Project } from '@/api/projects'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { PageHeader } from '@/components/ui/PageHeader'
import { dueRelative, isOverdue } from '@/lib/dueDate'
import { humanizeKey } from '@/lib/labels'
import { RUN_CASE_STATUS_TONE } from '@/lib/statusTones'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { EmptyState, ErrorState } from '@/components/ui/empty-state'
import { Skeleton } from '@/components/ui/skeleton'

interface ActiveRow {
  project: Project
  runId: string
  runName: string
  runCase: TestRunCase
}


// "Execution Console" as a sidebar landing page: a cross-project queue of
// test-run-cases currently in progress (or still pending in an active,
// unfinished run), each one a direct jump into the actual Execution
// Console (/test-run-cases/:id, unchanged). The console itself stays
// single-run-case-scoped per its existing design -- this page is purely
// the entry point the new sidebar needs, not a redesign of the console.
//
// ADR-123: `?projectId=` narrows the queue to one project and `?overdue=1` to run cases past their
// due date (the project dashboard's "Overdue test cases" widget links here with both).
export function ExecutionOverview() {
  const [searchParams, setSearchParams] = useSearchParams()
  const projectFilter = searchParams.get('projectId') ?? ''
  const overdueOnly = searchParams.get('overdue') === '1'
  const projectsQuery = useQuery({
    queryKey: ['projects', 'all'],
    queryFn: () => listProjects({ page_size: 100 }),
  })
  const allProjects = projectsQuery.data?.items ?? []
  const projects = projectFilter ? allProjects.filter((p) => p.id === projectFilter) : allProjects

  const runListQueries = useQueries({
    queries: projects.map((project) => ({
      queryKey: ['execution-overview', 'runs', project.id],
      queryFn: () => listTestRuns(project.id).then((runs) => ({ project, runs })),
    })),
  })

  const activeRunRefs = runListQueries.flatMap((q) =>
    q.data ? q.data.runs.filter((r) => !r.finished_at).map((r) => ({ project: q.data!.project, run: r })) : [],
  )

  const runDetailQueries = useQueries({
    queries: activeRunRefs.map(({ project, run }) => ({
      queryKey: ['execution-overview', 'run-detail', run.id],
      queryFn: () => getTestRun(run.id).then((full) => ({ project, full })),
    })),
  })

  const isLoading =
    projectsQuery.isLoading || runListQueries.some((q) => q.isLoading) || runDetailQueries.some((q) => q.isLoading)
  const isError =
    projectsQuery.isError || runListQueries.some((q) => q.isError) || runDetailQueries.some((q) => q.isError)

  const rows: ActiveRow[] = runDetailQueries
    .flatMap((q) => {
      if (!q.data) return []
      const { project, full } = q.data
      return full.cases
        .filter((c) => c.status === 'in_progress' || c.status === 'pending')
        .filter((c) => !overdueOnly || isOverdue(c.due_date, c.status))
        .map((runCase) => ({ project, runId: full.id, runName: full.name, runCase }))
    })
    .sort((a, b) =>
      overdueOnly
        ? (a.runCase.due_date ?? '').localeCompare(b.runCase.due_date ?? '')
        : a.runCase.status === b.runCase.status
          ? 0
          : a.runCase.status === 'in_progress'
            ? -1
            : 1,
    )
  const filterProject = allProjects.find((p) => p.id === projectFilter)

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Execution Console"
        description="Test cases awaiting or currently under execution, across every active test run you can see. Open one to continue executing it."
      />

      {(projectFilter || overdueOnly) && (
        <p
          role="status"
          data-testid="execution-filter-note"
          className="flex flex-wrap items-center gap-2 rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--muted)] px-3 py-2 text-sm"
        >
          <span>
            Showing {overdueOnly ? 'overdue ' : ''}run cases
            {projectFilter ? ` in ${filterProject?.name ?? 'this project'}` : ''}.
          </span>
          <button
            type="button"
            className="font-medium underline"
            onClick={() => setSearchParams(new URLSearchParams(), { replace: true })}
          >
            Show everything
          </button>
        </p>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Active Executions</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading && (
            <div role="status" className="flex flex-col gap-2">
              <span className="sr-only">Loading active executions</span>
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-14 w-full" />
              ))}
            </div>
          )}
          {isError && (
            <ErrorState
              message="Some projects or runs could not be loaded, so this list may be incomplete."
              onRetry={() => {
                projectsQuery.refetch()
                runListQueries.forEach((q) => q.isError && q.refetch())
                runDetailQueries.forEach((q) => q.isError && q.refetch())
              }}
            />
          )}
          {!isLoading && !isError && rows.length === 0 && (
            <EmptyState
              title={overdueOnly ? 'Nothing is overdue' : 'Nothing in progress right now'}
              description={
                overdueOnly
                  ? 'No run case in an open run is past its due date.'
                  : "Start a test run from a project's Test Runs tab and its cases will appear here."
              }
            />
          )}
          <ul className="flex flex-col gap-2">
            {rows.map(({ project, runId, runName, runCase }) => (
              <li key={runCase.id}>
                <Link
                  to={`/test-run-cases/${runCase.id}?runId=${runId}`}
                  className="flex items-center justify-between gap-4 rounded-md border border-[var(--border)] px-3 py-2 text-sm hover:bg-[var(--muted)]"
                >
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate font-medium">{runCase.title}</span>
                    <span className="truncate text-xs text-[var(--muted-foreground)]">
                      {project.name} · {runName}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-3">
                    {runCase.due_date && (
                      <span
                        className={
                          isOverdue(runCase.due_date, runCase.status)
                            ? 'text-xs font-medium text-[var(--status-serious)]'
                            : 'text-xs text-[var(--muted-foreground)]'
                        }
                      >
                        {dueRelative(runCase.due_date)}
                      </span>
                    )}
                    <span className="text-xs text-[var(--muted-foreground)]">
                      {runCase.passed_count}/{runCase.step_count} steps
                    </span>
                    <StatusBadge tone={RUN_CASE_STATUS_TONE[runCase.status]}>{humanizeKey(runCase.status)}</StatusBadge>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  )
}
