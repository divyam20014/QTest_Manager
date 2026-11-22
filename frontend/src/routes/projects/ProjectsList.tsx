import { type ReactNode, useEffect, useMemo, useState } from 'react'
import { keepPreviousData, useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { Link, useSearchParams } from 'react-router-dom'

import { ApiError } from '@/api/client'
import {
  createProject,
  listProjects,
  projectDomainFor,
  type Domain,
  type Priority,
  type Project,
  type ProjectCreateRequest,
  type ProjectStatus,
} from '@/api/projects'
import { getBranding } from '@/api/settings'
import { listUsers } from '@/api/users'
import { ColumnVisibilityMenu } from '@/components/table/ColumnVisibilityMenu'
import { useColumnPrefs, type TableColumnDef } from '@/components/table/tablePrefs'
import { ListFilterField, ListToolbar } from '@/components/list/ListToolbar'
import { RowDetailDrawer, type RowDetailConfig } from '@/components/list/RowDetailDrawer'
import { rowDetailProps } from '@/components/list/rowDetail'
import { buildStatusTabs } from '@/components/list/statusTabs'
import { FilterTabs } from '@/components/ui/filter-tabs'
import { filterTabId } from '@/components/ui/filterTabId'
import { LevelBadge } from '@/components/ui/LevelBadge'
import { useDebouncedValue } from '@/lib/useDebouncedValue'
import { CARD_LINK_CLASS, ResponsiveTable, type ResponsiveColumn } from '@/components/table/ResponsiveTable'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { PageHeader } from '@/components/ui/PageHeader'
import { EmptyState, ErrorState } from '@/components/ui/empty-state'
import { Pagination } from '@/components/ui/pagination'
import { Select } from '@/components/ui/select'
import { SegmentedToggle } from '@/components/ui/segmented'
import { useAuth } from '@/lib/auth'
import { useIsMobile } from '@/lib/useMediaQuery'
import { isManagerOrAbove } from '@/api/auth'
import { useToast } from '@/lib/toast'
import { ProjectForm, type ProjectFormValues } from './ProjectForm'
import { PRIORITY_TONE, STATUS_TONE } from './statusDisplay'

const DEFAULT_VALUES: ProjectFormValues = {
  name: '',
  domain: 'Motor',
  priority: 'Medium',
  status: 'On Track',
  manager_name: '',
  manager_user_id: '',
  start_date: '',
  end_date: '',
  budget: '0',
  region: '',
}

const DOMAINS: Domain[] = ['Motor', 'Health', 'Travel', 'Life', 'Property']
const STATUSES: ProjectStatus[] = ['On Track', 'At Risk', 'Delayed', 'Completed']
const PRIORITIES: Priority[] = ['Low', 'Medium', 'High', 'Critical']
const PAGE_SIZE = 10

// Low-priority columns start hidden so the table fits 1280px without scrolling sideways.
const PROJECT_COLUMN_DEFS: TableColumnDef[] = [
  { key: 'name', label: 'Name', alwaysVisible: true },
  { key: 'domain', label: 'Domain' },
  { key: 'status', label: 'Status', alwaysVisible: true },
  { key: 'priority', label: 'Priority' },
  { key: 'manager_name', label: 'Manager' },
  { key: 'region', label: 'Region', defaultHidden: true },
  { key: 'metrics', label: 'Test cases / runs / open defects' },
]

const PROJECT_DETAIL: RowDetailConfig<Project> = {
  entity: 'project',
  title: (p) => p.name,
  badges: (p) => (
    <>
      <StatusBadge tone={STATUS_TONE[p.status]}>{p.status}</StatusBadge>
      <LevelBadge tone={PRIORITY_TONE[p.priority]}>{p.priority} priority</LevelBadge>
    </>
  ),
  fields: (p) => [
    { label: 'Domain', value: p.domain },
    { label: 'Manager', value: p.manager_name },
    { label: 'Region', value: p.region },
    { label: 'Start date', value: p.start_date },
    { label: 'End date', value: p.end_date },
    { label: 'Test cases', value: `${p.test_case_count} (${p.approved_test_case_count} approved)` },
    { label: 'Test runs', value: p.test_run_count },
    { label: 'Open defects', value: p.open_defect_count },
  ],
  href: (p) => `/projects/${p.id}`,
}
// The list endpoint caps page_size at 100.
const MINE_FETCH_SIZE = 100

export function ProjectsList() {
  const { user } = useAuth()
  const [createOpen, setCreateOpen] = useState(false)
  const queryClient = useQueryClient()

  // Pass C (deferred item #3): the Dashboard's "Active Projects" KPI
  // links here with `?status=Active` -- read once on mount so that deep
  // link actually pre-filters instead of silently landing unfiltered.
  const [searchParams, setSearchParams] = useSearchParams()
  const [search, setSearch] = useState('')
  const debouncedSearch = useDebouncedValue(search.trim(), 300)
  const columnPrefs = useColumnPrefs('projects-list', PROJECT_COLUMN_DEFS)
  const [detailRow, setDetailRow] = useState<Project | null>(null)
  const [domain, setDomain] = useState<Domain | ''>('')
  const [status, setStatus] = useState<ProjectStatus | ''>(
    (searchParams.get('status') as ProjectStatus | null) ?? '',
  )
  const [priority, setPriority] = useState<Priority | ''>('')
  const [sort, setSort] = useState('name')
  const [page, setPage] = useState(1)
  // BRD FR-PROJ-02 "My Assigned / All Projects". The list endpoint has no
  // membership filter, so "mine" asks for the largest page it allows (100) and
  // keeps the projects whose `assigned_user_ids` include the signed-in user.
  // Kept in the URL as `?assigned=me`.
  const [mine, setMineState] = useState(searchParams.get('assigned') === 'me')
  function setMine(next: boolean) {
    setMineState(next)
    setPage(1)
    setSearchParams(
      (prev) => {
        const params = new URLSearchParams(prev)
        if (next) params.set('assigned', 'me')
        else params.delete('assigned')
        return params
      },
      { replace: true },
    )
  }

  // Phase 2: the command palette's "Create Project" quick action
  // navigates here with ?action=create -- reuses this existing create
  // dialog rather than inventing a new creation flow.
  useEffect(() => {
    if (searchParams.get('action') === 'create') {
      setCreateOpen(true)
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          next.delete('action')
          return next
        },
        { replace: true },
      )
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams])

  // "My projects" fetches the largest page once (without the status tab) and narrows it here, so the
  // status tab counts below stay exact for what the user can see.
  const projectsQuery = useQuery({
    queryKey: ['projects', { search: debouncedSearch, domain, status: mine ? '' : status, priority, sort, page: mine ? 'mine' : page }],
    queryFn: () =>
      mine
        ? listProjects({ search: debouncedSearch, domain, priority, sort, page: 1, page_size: MINE_FETCH_SIZE })
        : listProjects({ search: debouncedSearch, domain, status, priority, sort, page, page_size: PAGE_SIZE }),
    placeholderData: keepPreviousData,
  })
  const countQueries = useQueries({
    queries: STATUSES.map((s) => ({
      queryKey: ['projects', 'status-count', { s, search: debouncedSearch, domain, priority }],
      queryFn: () =>
        listProjects({ search: debouncedSearch, domain, priority, status: s, page: 1, page_size: 1 }).then((r) => r.total),
      enabled: !mine,
      placeholderData: keepPreviousData,
    })),
  })

  const { show: showToast } = useToast()
  const createMutation = useMutation({
    mutationFn: (req: ProjectCreateRequest) => createProject(req),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] })
      setCreateOpen(false)
      showToast('success', 'Project created')
    },
    // No onError toast here -- `createError` already renders this same
    // message inline via the form's `serverError` prop; toasting it too
    // would duplicate the text and trip strict-mode locators that match
    // on it (confirmed by a real Playwright failure during this pass).
  })

  const canCreate = isManagerOrAbove(user)
  const usersQuery = useQuery({ queryKey: ['users'], queryFn: listUsers, enabled: canCreate })
  // BRD gap Phase 4 (FR-AUTH-04): the organisation's primary insurance domain
  // pre-selects a new project's Domain. Same query key as the app shell, so
  // it is normally already cached; "Other"/unset keeps the existing default.
  const brandingQuery = useQuery({ queryKey: ['branding'], queryFn: getBranding, enabled: canCreate })
  const tenantDomain = projectDomainFor(brandingQuery.data?.primary_domain)
  const newProjectDefaults = useMemo<ProjectFormValues>(
    () => ({ ...DEFAULT_VALUES, domain: tenantDomain ?? DEFAULT_VALUES.domain }),
    [tenantDomain],
  )
  const createError = createMutation.error instanceof ApiError ? createMutation.error.message : null

  const isMobile = useIsMobile()
  const fetched = projectsQuery.data?.items ?? []
  const myProjects = mine && user ? fetched.filter((p) => p.assigned_user_ids.includes(user.user_id)) : []
  const myInStatus = status ? myProjects.filter((p) => p.status === status) : myProjects
  const total = mine ? myInStatus.length : (projectsQuery.data?.total ?? 0)
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const filtersActive = Boolean(search || domain || status || priority || mine)
  // Search and the status tab have their own controls; this clears the filters in the panel.
  function clearFilters() {
    setDomain('')
    setPriority('')
    setMine(false)
    setPage(1)
  }
  function clearAll() {
    clearFilters()
    setSearch('')
    setStatus('')
  }
  const countsReady = mine ? projectsQuery.data !== undefined : countQueries.every((q) => q.data !== undefined)
  const statusCounts: Record<string, number> = Object.fromEntries(
    STATUSES.map((s, i) => [s, mine ? myProjects.filter((p) => p.status === s).length : (countQueries[i].data ?? 0)]),
  )
  const statusTabs = buildStatusTabs({
    order: STATUSES,
    counts: statusCounts,
    total: Object.values(statusCounts).reduce((a, b) => a + b, 0),
    ready: countsReady,
  })
  const chips = [
    ...(mine ? [{ key: 'mine', label: 'Projects', value: 'Mine' }] : []),
    ...(domain ? [{ key: 'domain', label: 'Domain', value: domain }] : []),
    ...(priority ? [{ key: 'priority', label: 'Priority', value: priority }] : []),
  ]
  function removeChip(key: string) {
    if (key === 'mine') setMine(false)
    else if (key === 'domain') resetToFirstPage(setDomain)('')
    else if (key === 'priority') resetToFirstPage(setPriority)('')
  }
  const rows = mine ? myInStatus.slice((page - 1) * PAGE_SIZE, (page) * PAGE_SIZE) : fetched
  // More projects match than one request can return: say so rather than
  // silently presenting a partial "mine" list as complete.
  const mineTruncated = mine && (projectsQuery.data?.total ?? 0) > fetched.length

  function resetToFirstPage<T>(setter: (v: T) => void) {
    return (value: T) => {
      setter(value)
      setPage(1)
    }
  }

  function toggleSort(key: string) {
    setSort((current) => {
      const currentKey = current.replace(/^-/, '')
      if (currentKey !== key) return key
      return current.startsWith('-') ? key : `-${key}`
    })
    setPage(1)
  }

  const sortHeader = (key: string, label: string): ReactNode => {
    const isActive = sort.replace(/^-/, '') === key
    return (
      <button
        type="button"
        className="flex items-center gap-1 hover:text-[var(--foreground)]"
        onClick={() => toggleSort(key)}
      >
        {label}
        {isActive &&
          (sort.startsWith('-') ? <ChevronDown className="size-3.5" /> : <ChevronUp className="size-3.5" />)}
      </button>
    )
  }

  const columns: ResponsiveColumn<Project>[] = [
    {
      key: 'name',
      header: 'Name',
      headerCell: sortHeader('name', 'Name'),
      card: 'title',
      cell: (project) => (
        <Link to={`/projects/${project.id}`} className="font-medium underline-offset-2 hover:underline">
          {project.name}
        </Link>
      ),
      cardCell: (project) => (
        <Link to={`/projects/${project.id}`} className={CARD_LINK_CLASS}>
          {project.name}
        </Link>
      ),
    },
    { key: 'domain', header: 'Domain', cell: (project) => project.domain },
    {
      key: 'status',
      header: 'Status',
      headerCell: sortHeader('status', 'Status'),
      card: 'badge',
      cell: (project) => <StatusBadge tone={STATUS_TONE[project.status]}>{project.status}</StatusBadge>,
    },
    {
      key: 'priority',
      header: 'Priority',
      headerCell: sortHeader('priority', 'Priority'),
      card: 'badge',
      cell: (project) => <LevelBadge tone={PRIORITY_TONE[project.priority]}>{project.priority}</LevelBadge>,
    },
    { key: 'manager_name', header: 'Manager', cell: (project) => project.manager_name },
    { key: 'region', header: 'Region', cell: (project) => project.region },
    {
      key: 'metrics',
      header: 'Test Cases / Runs / Open Defects',
      cardLabel: 'Cases / Runs / Open defects',
      tdClassName: 'text-[var(--muted-foreground)]',
      cell: (project) => (
        <>
          {project.test_case_count} ({project.approved_test_case_count} approved) / {project.test_run_count} /{' '}
          {project.open_defect_count}
        </>
      ),
    },
  ]

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Projects"
        actions={canCreate && <Button onClick={() => setCreateOpen(true)}>New Project</Button>}
      />

      <FilterTabs
        label="Project status"
        items={statusTabs}
        value={status}
        onChange={(key) => resetToFirstPage(setStatus)(key as ProjectStatus | '')}
        panelId="projects-panel"
      />

      <ListToolbar
        search={{
          id: 'project-search',
          value: search,
          onChange: resetToFirstPage(setSearch),
          placeholder: 'Search by name…',
        }}
        activeCount={chips.length}
        onClearFilters={clearFilters}
        chips={chips}
        onRemoveChip={removeChip}
        columns={
          <ColumnVisibilityMenu
            columns={PROJECT_COLUMN_DEFS}
            isVisible={columnPrefs.isVisible}
            toggleVisible={columnPrefs.toggleVisible}
            showAll={columnPrefs.showAll}
            density={columnPrefs.density}
            setDensity={columnPrefs.setDensity}
          />
        }
        quick={
          <SegmentedToggle
            label="Which projects to show"
            value={mine ? 'mine' : 'all'}
            onChange={(v) => setMine(v === 'mine')}
            options={[
              { value: 'all', label: 'All projects' },
              { value: 'mine', label: 'My projects' },
            ]}
          />
        }
        filters={
          <>
            <ListFilterField label="Domain">
              <Select
                id="filter-domain"
                aria-label="Domain"
                value={domain}
                onChange={(e) => resetToFirstPage(setDomain)(e.target.value as Domain | '')}
              >
                <option value="">All domains</option>
                {DOMAINS.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </Select>
            </ListFilterField>
            <ListFilterField label="Priority">
              <Select
                id="filter-priority"
                aria-label="Priority"
                value={priority}
                onChange={(e) => resetToFirstPage(setPriority)(e.target.value as Priority | '')}
              >
                <option value="">All priorities</option>
                {PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </Select>
            </ListFilterField>
            {isMobile && (
              <ListFilterField label="Sort by">
                <Select
                  id="sort-projects"
                  aria-label="Sort by"
                  value={sort}
                  onChange={(e) => {
                    setSort(e.target.value)
                    setPage(1)
                  }}
                >
                  <option value="name">Name (A-Z)</option>
                  <option value="-name">Name (Z-A)</option>
                  <option value="status">Status</option>
                  <option value="priority">Priority (A-Z)</option>
                  <option value="-priority">Priority (Z-A)</option>
                </Select>
              </ListFilterField>
            )}
          </>
        }
      />

      <div
        id="projects-panel"
        role="tabpanel"
        aria-labelledby={filterTabId('projects-panel', status)}
        className="flex flex-col gap-4"
      >
      <ResponsiveTable
        label="Projects"
        rows={rows}
        rowKey={(p) => p.id}
        columns={columns}
        prefs={columnPrefs}
        rowProps={(p) => rowDetailProps(() => setDetailRow(p))}
        loading={projectsQuery.isLoading}
        stateCellClassName="px-4"
        state={
          projectsQuery.isError ? (
            <ErrorState error={projectsQuery.error} onRetry={() => projectsQuery.refetch()} />
          ) : projectsQuery.data && rows.length === 0 ? (
            filtersActive ? (
              <EmptyState
                variant="filtered"
                title={mine ? 'None of your projects match these filters' : 'No projects match these filters'}
                description="Try clearing a filter or the search to see more projects."
                action={
                  <Button variant="outline" size="sm" onClick={clearAll}>
                    Clear filters
                  </Button>
                }
              />
            ) : (
              <EmptyState
                title="No projects yet"
                description="A project groups the requirements, test cases, runs and defects for one product."
                action={
                  canCreate ? (
                    <Button size="sm" onClick={() => setCreateOpen(true)}>
                      Create your first project
                    </Button>
                  ) : undefined
                }
              />
            )
          ) : undefined
        }
      />

      {mineTruncated && (
        <p role="status" className="text-xs text-[var(--muted-foreground)]">
          Checked the first {fetched.length} of {projectsQuery.data?.total} matching projects for your assignments. Narrow
          the search or filters to check the rest.
        </p>
      )}

      <Pagination
        page={page}
        totalPages={totalPages}
        total={total}
        noun="project"
        pageSize={PAGE_SIZE}
        onPageChange={setPage}
      />
      </div>
      <RowDetailDrawer row={detailRow} onClose={() => setDetailRow(null)} config={PROJECT_DETAIL} />

      <Dialog open={createOpen} onClose={() => setCreateOpen(false)} title="New Project">
        <ProjectForm
          inDialog
          defaultValues={newProjectDefaults}
          submitLabel="Create Project"
          isSubmitting={createMutation.isPending}
          serverError={createError}
          users={usersQuery.data ?? []}
          onSubmit={(values) => createMutation.mutate(values)}
        />
      </Dialog>
    </div>
  )
}
