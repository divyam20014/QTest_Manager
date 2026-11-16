import { useState } from 'react'
import { useQueries, useQuery } from '@tanstack/react-query'
import { Link, useSearchParams } from 'react-router-dom'

import { listTestRuns, type TestRunSummary } from '@/api/execution'
import { listProjects, type Project } from '@/api/projects'
import { FilterBar } from '@/components/table/FilterBar'
import { CARD_LINK_CLASS, ResponsiveTable, type ResponsiveColumn } from '@/components/table/ResponsiveTable'
import { Badge } from '@/components/ui/badge'
import { PageHeader } from '@/components/ui/PageHeader'
import { Pagination } from '@/components/ui/pagination'
import { Select } from '@/components/ui/select'

const RUNS_PAGE_SIZE = 50

type OverviewRow = { project: Project; run: TestRunSummary }

const OVERVIEW_COLUMNS: ResponsiveColumn<OverviewRow>[] = [
  {
    key: 'run',
    header: 'Run',
    card: 'title',
    cell: ({ run }) => (
      <Link to={`/test-runs/${run.id}`} className="font-medium underline-offset-2 hover:underline">
        {run.name}
      </Link>
    ),
    cardCell: ({ run }) => (
      <Link to={`/test-runs/${run.id}`} className={CARD_LINK_CLASS}>
        {run.name}
      </Link>
    ),
  },
  {
    key: 'status',
    header: 'Status',
    card: 'badge',
    cell: ({ run }) => (
      <Badge tone={run.finished_at ? 'neutral' : run.paused_at ? 'warning' : 'positive'}>
        {run.finished_at ? 'Finished' : run.paused_at ? 'Paused' : 'Active'}
      </Badge>
    ),
  },
  {
    key: 'project',
    header: 'Project',
    cell: ({ project }) => (
      <Link to={`/projects/${project.id}/test-runs`} className="relative z-10 text-[var(--muted-foreground)] hover:underline">
        {project.name}
      </Link>
    ),
  },
  { key: 'type', header: 'Type', tdClassName: 'text-[var(--muted-foreground)]', cell: ({ run }) => run.run_type },
  { key: 'cases', header: 'Cases', cell: ({ run }) => run.case_count },
  {
    key: 'created',
    header: 'Created',
    tdClassName: 'text-xs text-[var(--muted-foreground)]',
    cell: ({ run }) => new Date(run.created_at).toLocaleDateString(),
  },
]

// Cross-project test run overview (foundation pass for the "Test Runs"
// sidebar item). Same client-side-merge approach as TestRepository.tsx --
// no tenant-wide /test-runs endpoint exists, so each project's runs are
// fetched and merged here rather than adding a new backend aggregate.
export function TestRunsOverview() {
  const [projectId, setProjectId] = useState('')
  // Pass C (deferred item #3): the Dashboard's "Active Test Runs" KPI
  // links here with `?status=in_progress`, a deep link that silently did
  // nothing until this page actually read it. Read once on mount (not a
  // full bidirectional URL sync like Test Cases/Defects got, since this
  // page has only the one boolean toggle) so landing on that link
  // actually pre-filters.
  const [searchParams] = useSearchParams()
  // Bug #9: this previously defaulted to hiding finished runs, so a
  // tenant with only finished runs saw a dead-end "No test runs match"
  // on first visit even though data existed. Show everything by default;
  // the toggle now narrows down to active-only instead of opting in to
  // seeing finished runs at all.
  const [activeOnly, setActiveOnly] = useState(searchParams.get('status') === 'in_progress')

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
  const rows: OverviewRow[] = perProjectQueries
    .flatMap((q) => (q.data ? q.data.runs.map((run) => ({ project: q.data!.project, run })) : []))
    .filter((r) => !activeOnly || !r.run.finished_at)
    .sort((a, b) => b.run.created_at.localeCompare(a.run.created_at))

  // Every project's runs are fetched, so page the merged list on the client
  // (50 per page) to keep the DOM small; resets when a filter changes.
  const filterKey = `${projectId}|${activeOnly}`
  const [paging, setPaging] = useState({ key: filterKey, page: 1 })
  const totalPages = Math.max(1, Math.ceil(rows.length / RUNS_PAGE_SIZE))
  const page = Math.min(paging.key === filterKey ? paging.page : 1, totalPages)
  const pageRows = rows.slice((page - 1) * RUNS_PAGE_SIZE, page * RUNS_PAGE_SIZE)

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Test Runs" description="Test runs across every project you can see." />

      <FilterBar activeCount={(projectId ? 1 : 0) + (activeOnly ? 1 : 0)} onClear={() => { setProjectId(''); setActiveOnly(false) }} desktopClear={false}>
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
        <label className="flex min-h-11 items-center gap-2 pb-2 text-sm md:min-h-0">
          <input
            type="checkbox"
            checked={activeOnly}
            onChange={(e) => setActiveOnly(e.target.checked)}
          />
          Active runs only
        </label>
      </FilterBar>

      <ResponsiveTable
        label="Test runs"
        rows={pageRows}
        rowKey={(r) => r.run.id}
        columns={OVERVIEW_COLUMNS}
        loading={isLoading}
        className="bg-[var(--background)]"
        state={
          !isLoading && rows.length === 0 ? (
            <p className="py-6 text-center text-sm text-[var(--muted-foreground)]">
              No test runs match these filters.
            </p>
          ) : undefined
        }
      />
      {rows.length > RUNS_PAGE_SIZE && (
        <Pagination
          page={page}
          totalPages={totalPages}
          total={rows.length}
          noun="run"
          onPageChange={(next) => setPaging({ key: filterKey, page: next })}
        />
      )}
    </div>
  )
}
