import { useQueries, useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'

import { listTestRuns, getTestRun, type TestRunCase } from '@/api/execution'
import { listProjects, type Project } from '@/api/projects'
import { Badge } from '@/components/ui/badge'
import { humanizeKey } from '@/lib/labels'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

interface ActiveRow {
  project: Project
  runId: string
  runName: string
  runCase: TestRunCase
}

const STATUS_TONE: Record<string, 'neutral' | 'positive' | 'warning' | 'critical'> = {
  pending: 'neutral',
  in_progress: 'warning',
  passed: 'positive',
  failed: 'critical',
  blocked: 'critical',
  ignored: 'neutral',
}

// "Execution Console" as a sidebar landing page: a cross-project queue of
// test-run-cases currently in progress (or still pending in an active,
// unfinished run), each one a direct jump into the actual Execution
// Console (/test-run-cases/:id, unchanged). The console itself stays
// single-run-case-scoped per its existing design -- this page is purely
// the entry point the new sidebar needs, not a redesign of the console.
export function ExecutionOverview() {
  const projectsQuery = useQuery({
    queryKey: ['projects', 'all'],
    queryFn: () => listProjects({ page_size: 100 }),
  })
  const projects = projectsQuery.data?.items ?? []

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

  const isLoading = runListQueries.some((q) => q.isLoading) || runDetailQueries.some((q) => q.isLoading)

  const rows: ActiveRow[] = runDetailQueries
    .flatMap((q) => {
      if (!q.data) return []
      const { project, full } = q.data
      return full.cases
        .filter((c) => c.status === 'in_progress' || c.status === 'pending')
        .map((runCase) => ({ project, runId: full.id, runName: full.name, runCase }))
    })
    .sort((a, b) => (a.runCase.status === b.runCase.status ? 0 : a.runCase.status === 'in_progress' ? -1 : 1))

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold">Execution Console</h1>
      <p className="text-sm text-[var(--muted-foreground)]">
        Test cases awaiting or currently under execution, across every active test run you can see. Open one to
        continue executing it.
      </p>

      <Card>
        <CardHeader>
          <CardTitle>Active Executions</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading && <p className="text-sm text-[var(--muted-foreground)]">Loading…</p>}
          {!isLoading && rows.length === 0 && (
            <p className="text-sm text-[var(--muted-foreground)]">
              Nothing in progress right now. Start a test run from a project's Test Runs tab.
            </p>
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
                    <span className="text-xs text-[var(--muted-foreground)]">
                      {runCase.passed_count}/{runCase.step_count} steps
                    </span>
                    <Badge tone={STATUS_TONE[runCase.status]}>{humanizeKey(runCase.status)}</Badge>
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
