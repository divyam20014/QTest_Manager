import { useState } from 'react'
import { useQueries, useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'

import { listTestRuns, type TestRunSummary } from '@/api/execution'
import { listProjects, type Project } from '@/api/projects'
import { Badge } from '@/components/ui/badge'
import { Select } from '@/components/ui/select'

// Cross-project test run overview (foundation pass for the "Test Runs"
// sidebar item). Same client-side-merge approach as TestRepository.tsx --
// no tenant-wide /test-runs endpoint exists, so each project's runs are
// fetched and merged here rather than adding a new backend aggregate.
export function TestRunsOverview() {
  const [projectId, setProjectId] = useState('')
  const [showFinished, setShowFinished] = useState(false)

  const projectsQuery = useQuery({
    queryKey: ['projects', 'all'],
    queryFn: () => listProjects({ page_size: 100 }),
  })
  const projects = projectsQuery.data?.items ?? []
  const targetProjects = projectId ? projects.filter((p) => p.id === projectId) : projects

  const perProjectQueries = useQueries({
    queries: targetProjects.map((project) => ({
      queryKey: ['test-runs-overview', project.id],
      queryFn: () => listTestRuns(project.id).then((runs) => ({ project, runs })),
    })),
  })

  const isLoading = perProjectQueries.some((q) => q.isLoading)
  const rows: { project: Project; run: TestRunSummary }[] = perProjectQueries
    .flatMap((q) => (q.data ? q.data.runs.map((run) => ({ project: q.data!.project, run })) : []))
    .filter((r) => showFinished || !r.run.finished_at)
    .sort((a, b) => b.run.created_at.localeCompare(a.run.created_at))

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold">Test Runs</h1>

      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="runs-project" className="text-xs text-[var(--muted-foreground)]">
            Project
          </label>
          <Select
            id="runs-project"
            className="w-48"
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
          >
            <option value="">All projects</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </div>
        <label className="flex items-center gap-2 pb-2 text-sm">
          <input
            type="checkbox"
            checked={showFinished}
            onChange={(e) => setShowFinished(e.target.checked)}
          />
          Include finished runs
        </label>
      </div>

      <div className="overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--background)]">
        <table className="w-full text-sm">
          <thead className="bg-[var(--muted)] text-left text-xs text-[var(--muted-foreground)]">
            <tr>
              <th className="px-4 py-2 font-medium">Run</th>
              <th className="px-4 py-2 font-medium">Project</th>
              <th className="px-4 py-2 font-medium">Type</th>
              <th className="px-4 py-2 font-medium">Cases</th>
              <th className="px-4 py-2 font-medium">Status</th>
              <th className="px-4 py-2 font-medium">Created</th>
            </tr>
          </thead>
          <tbody>
            {!isLoading && rows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-[var(--muted-foreground)]">
                  No test runs match these filters.
                </td>
              </tr>
            )}
            {isLoading && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-[var(--muted-foreground)]">
                  Loading…
                </td>
              </tr>
            )}
            {rows.map(({ project, run }) => (
              <tr key={run.id} className="border-t border-[var(--border)] hover:bg-[var(--muted)]">
                <td className="px-4 py-2">
                  <Link to={`/test-runs/${run.id}`} className="font-medium underline-offset-2 hover:underline">
                    {run.name}
                  </Link>
                </td>
                <td className="px-4 py-2">
                  <Link
                    to={`/projects/${project.id}/test-runs`}
                    className="text-[var(--muted-foreground)] hover:underline"
                  >
                    {project.name}
                  </Link>
                </td>
                <td className="px-4 py-2 text-[var(--muted-foreground)]">{run.run_type}</td>
                <td className="px-4 py-2">{run.case_count}</td>
                <td className="px-4 py-2">
                  <Badge tone={run.finished_at ? 'neutral' : run.paused_at ? 'warning' : 'positive'}>
                    {run.finished_at ? 'Finished' : run.paused_at ? 'Paused' : 'Active'}
                  </Badge>
                </td>
                <td className="px-4 py-2 text-xs text-[var(--muted-foreground)]">
                  {new Date(run.created_at).toLocaleDateString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
