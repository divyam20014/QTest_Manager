import { useState } from 'react'
import { keepPreviousData, useQueries, useQuery } from '@tanstack/react-query'
import { Link, useSearchParams } from 'react-router-dom'

import { listAllTestRuns, type TestRunSummary } from '@/api/execution'
import { listProjects, type Project } from '@/api/projects'
import { ListFilterField, ListToolbar } from '@/components/list/ListToolbar'
import { RowDetailDrawer, type RowDetailConfig } from '@/components/list/RowDetailDrawer'
import { rowDetailProps } from '@/components/list/rowDetail'
import { buildStatusTabs } from '@/components/list/statusTabs'
import { FilterTabs } from '@/components/ui/filter-tabs'
import { filterTabId } from '@/components/ui/filterTabId'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { useDebouncedValue } from '@/lib/useDebouncedValue'
import { RUN_STATUSES, RUN_STATUS_LABEL, RUN_STATUS_TONE, runStatusOf, type RunStatus } from './runStatus'
import { ViewsMenu } from '@/components/table/ViewsMenu'
import { useApplyDefaultView, type ViewState } from '@/components/table/viewsHelpers'
import { ColumnVisibilityMenu } from '@/components/table/ColumnVisibilityMenu'
import { useColumnPrefs, type TableColumnDef } from '@/components/table/tablePrefs'
import { CARD_LINK_CLASS, ResponsiveTable, type ResponsiveColumn } from '@/components/table/ResponsiveTable'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/ui/PageHeader'
import { EmptyState, ErrorState } from '@/components/ui/empty-state'
import { Pagination } from '@/components/ui/pagination'
import { Select } from '@/components/ui/select'
import { ViewSwitcher } from '@/components/list/ViewSwitcher'
import { parseViewMode, useViewMode, type ViewMode } from '@/lib/viewMode'
import { RunsBoard } from './RunsBoard'
import { RunsCalendar } from './RunsCalendar'

const RUNS_PAGE_SIZE = 50
// ADR-124: runs are also shown as a board by status and on a calendar.
const RUN_MODES: readonly ViewMode[] = ['list', 'board', 'calendar']

type OverviewRow = { project: Project; run: TestRunSummary }

const OVERVIEW_COLUMN_DEFS: TableColumnDef[] = [
  { key: 'run', label: 'Run', alwaysVisible: true },
  { key: 'status', label: 'Status', alwaysVisible: true },
  { key: 'project', label: 'Project' },
  { key: 'type', label: 'Type' },
  { key: 'cases', label: 'Cases' },
  { key: 'created', label: 'Created' },
]

const RUN_DETAIL: RowDetailConfig<OverviewRow> = {
  entity: 'test run',
  title: ({ run }) => run.name,
  badges: ({ run }) => (
    <StatusBadge tone={RUN_STATUS_TONE[runStatusOf(run)]}>{RUN_STATUS_LABEL[runStatusOf(run)]}</StatusBadge>
  ),
  fields: ({ run, project }) => [
    { label: 'ID', value: <span className="font-mono text-xs">{run.id.slice(0, 8)}</span> },
    { label: 'Project', value: project.name },
    { label: 'Type', value: run.run_type },
    { label: 'Cases', value: run.case_count },
    { label: 'Created', value: new Date(run.created_at).toLocaleDateString() },
    { label: 'Finished', value: run.finished_at ? new Date(run.finished_at).toLocaleDateString() : '—' },
  ],
  href: ({ run }) => `/test-runs/${run.id}`,
}

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
      <StatusBadge tone={RUN_STATUS_TONE[runStatusOf(run)]}>{RUN_STATUS_LABEL[runStatusOf(run)]}</StatusBadge>
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
  const columnPrefs = useColumnPrefs('test-runs-overview', OVERVIEW_COLUMN_DEFS)
  const [projectId, setProjectId] = useState('')
  // Pass C (deferred item #3): the Dashboard's "Active Test Runs" KPI
  // links here with `?status=in_progress`, a deep link that silently did
  // nothing until this page actually read it. Read once on mount (not a
  // full bidirectional URL sync like Test Cases/Defects got, since this
  // page has only the one boolean toggle) so landing on that link
  // actually pre-filters.
  const [searchParams, setSearchParams] = useSearchParams()
  const { mode: viewMode, setMode: setViewMode } = useViewMode('test_runs', RUN_MODES)
  // Bug #9: this previously defaulted to hiding finished runs, so a
  // tenant with only finished runs saw a dead-end "No test runs match"
  // on first visit even though data existed. Show everything by default;
  // the toggle now narrows down to active-only instead of opting in to
  // seeing finished runs at all.
  const initialStatus = searchParams.get('status')
  const [status, setStatus] = useState<RunStatus | ''>(
    (RUN_STATUSES as string[]).includes(initialStatus ?? '') ? (initialStatus as RunStatus) : '',
  )
  const [search, setSearch] = useState('')
  const debouncedSearch = useDebouncedValue(search.trim(), 300)
  const [detailRow, setDetailRow] = useState<OverviewRow | null>(null)

  // ADR-096: saved views map onto this page's two local filters.
  const applyView = (view: ViewState) => {
    setProjectId(view.filters.projectId ?? '')
    const saved = view.filters.status ?? (view.filters.activeOnly === 'true' ? 'in_progress' : '')
    setStatus((RUN_STATUSES as string[]).includes(saved) ? (saved as RunStatus) : '')
    // The saved view mode (and the calendar's overdue switch) live in the URL; one update sets both.
    const mode = parseViewMode(view.filters.view, RUN_MODES)
    setSearchParams(
      (prev) => {
        const p = new URLSearchParams(prev)
        if (mode) p.set('view', mode)
        if (view.filters.overdue === 'true') p.set('overdue', 'true')
        else p.delete('overdue')
        return p
      },
      { replace: true },
    )
  }
  useApplyDefaultView('test_runs', Boolean(projectId) || Boolean(status), applyView)

  const projectsQuery = useQuery({
    queryKey: ['projects', 'all'],
    queryFn: () => listProjects({ page_size: 100 }),
  })
  const projects = projectsQuery.data?.items ?? []

  // ADR-078: the server pages the runs across every project the caller can see (newest
  // first), so one page is downloaded however many projects and runs exist. The page
  // resets to 1 when a filter changes.
  const filterKey = `${projectId}|${status}|${debouncedSearch}`
  const [paging, setPaging] = useState({ key: filterKey, page: 1 })
  const page = paging.key === filterKey ? paging.page : 1
  const runsQuery = useQuery({
    queryKey: ['test-runs-overview', { projectId, status, search: debouncedSearch, page }],
    queryFn: () =>
      listAllTestRuns({
        project_id: projectId || undefined,
        status: status || undefined,
        search: debouncedSearch || undefined,
        page,
        page_size: RUNS_PAGE_SIZE,
      }),
    placeholderData: keepPreviousData,
  })
  // Status tab counts: a one-row request per tab (only `total` is read), under the project and
  // search filters. "All" is the sum of the three statuses.
  const countQueries = useQueries({
    queries: RUN_STATUSES.map((s) => ({
      queryKey: ['test-runs-overview', 'count', { s, projectId, search: debouncedSearch }],
      queryFn: () =>
        listAllTestRuns({
          project_id: projectId || undefined,
          status: s,
          search: debouncedSearch || undefined,
          page: 1,
          page_size: 1,
        }).then((r) => r.total),
      placeholderData: keepPreviousData,
    })),
  })
  const countsReady = countQueries.every((q) => q.data !== undefined)
  const statusCounts = Object.fromEntries(RUN_STATUSES.map((s, i) => [s, countQueries[i].data ?? 0]))
  const statusTabs = buildStatusTabs({
    order: RUN_STATUSES,
    counts: statusCounts,
    total: Object.values(statusCounts).reduce((a, b) => a + b, 0),
    ready: countsReady,
    labels: RUN_STATUS_LABEL,
  })
  const chips = projectId
    ? [{ key: 'project', label: 'Project', value: projects.find((p) => p.id === projectId)?.name ?? projectId }]
    : []
  const isLoading = runsQuery.isLoading
  const total = runsQuery.data?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / RUNS_PAGE_SIZE))
  // Runs can be deleted while on a later page: if that page no longer exists, step back to
  // the last one that does (a state update during render, which React re-runs immediately).
  if (runsQuery.data && runsQuery.data.items.length === 0 && page > totalPages) {
    setPaging({ key: filterKey, page: totalPages })
  }
  // The project list holds up to 100 projects; a run in one beyond that still shows,
  // just without a project name.
  const projectsById = new Map(projects.map((p) => [p.id, p]))
  const pageRows: OverviewRow[] = (runsQuery.data?.items ?? []).map((run) => ({
    project: projectsById.get(run.project_id) ?? ({ id: run.project_id, name: 'Project' } as Project),
    run,
  }))
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Test Runs" description="Test runs across every project you can see." />

      {viewMode === 'list' && (
        <FilterTabs
          label="Test run status"
          items={statusTabs}
          value={status}
          onChange={(key) => setStatus(key as RunStatus | '')}
          panelId="runs-panel"
        />
      )}

      <ListToolbar
        search={{ id: 'runs-search', value: search, onChange: setSearch, placeholder: 'Search runs by name…' }}
        activeCount={chips.length}
        onClearFilters={() => setProjectId('')}
        chips={chips}
        onRemoveChip={() => setProjectId('')}
        view={<ViewSwitcher modes={RUN_MODES} value={viewMode} onChange={setViewMode} />}
        saved={
          <ViewsMenu
            listKey="test_runs"
            current={{
              filters: {
                ...(projectId ? { projectId } : {}),
                ...(status ? { status } : {}),
                view: viewMode,
                ...(viewMode === 'calendar' && searchParams.get('overdue') === 'true' ? { overdue: 'true' } : {}),
              },
              sort: null,
            }}
            onApply={applyView}
          />
        }
        columns={
          viewMode !== 'list' ? undefined : <ColumnVisibilityMenu
            columns={OVERVIEW_COLUMN_DEFS}
            isVisible={columnPrefs.isVisible}
            toggleVisible={columnPrefs.toggleVisible}
            showAll={columnPrefs.showAll}
            density={columnPrefs.density}
            setDensity={columnPrefs.setDensity}
          />
        }
        filters={
          <ListFilterField label="Project">
            <Select
              id="runs-project"
              aria-label="Project"
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
          </ListFilterField>
        }
      />

      <div
        id="runs-panel"
        role={viewMode === 'list' ? 'tabpanel' : undefined}
        aria-labelledby={viewMode === 'list' ? filterTabId('runs-panel', status) : undefined}
        className="flex flex-col gap-4"
      >
      {viewMode === 'board' ? (
        <RunsBoard projectId={projectId || undefined} search={debouncedSearch || undefined} projectNames={new Map(projects.map((p) => [p.id, p.name]))} />
      ) : viewMode === 'calendar' ? (
        <RunsCalendar projectId={projectId || undefined} />
      ) : (
      <>
      <ResponsiveTable
        label="Test runs"
        prefs={columnPrefs}
        rows={pageRows}
        rowKey={(r) => r.run.id}
        columns={OVERVIEW_COLUMNS}
        rowProps={(r) => rowDetailProps(() => setDetailRow(r))}
        loading={isLoading}
        className="bg-[var(--background)]"
        state={
          runsQuery.isError ? (
            <ErrorState error={runsQuery.error} onRetry={() => runsQuery.refetch()} />
          ) : !isLoading && total === 0 ? (
            projectId || status || debouncedSearch ? (
              <EmptyState
                variant="filtered"
                title="No test runs match these filters"
                description="Try clearing a filter to see more runs."
                action={
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setProjectId('')
                      setStatus('')
                      setSearch('')
                    }}
                  >
                    Clear filters
                  </Button>
                }
              />
            ) : (
              <EmptyState
                title="No test runs yet"
                description="Runs from every project you can see appear here. Start one from a project's Test Runs tab."
              />
            )
          ) : undefined
        }
      />
      <Pagination
        page={page}
        totalPages={totalPages}
        total={total}
        noun="run"
        pageSize={RUNS_PAGE_SIZE}
        onPageChange={(next) => setPaging({ key: filterKey, page: next })}
      />
      </>
      )}
      </div>
      <RowDetailDrawer row={detailRow} onClose={() => setDetailRow(null)} config={RUN_DETAIL} />
    </div>
  )
}
