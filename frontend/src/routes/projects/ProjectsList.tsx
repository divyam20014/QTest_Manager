import { type ReactNode, useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { Link, useSearchParams } from 'react-router-dom'

import { ApiError } from '@/api/client'
import {
  createProject,
  listProjects,
  type Domain,
  type Priority,
  type Project,
  type ProjectCreateRequest,
  type ProjectStatus,
} from '@/api/projects'
import { listUsers } from '@/api/users'
import { FilterBar } from '@/components/table/FilterBar'
import { CARD_LINK_CLASS, ResponsiveTable, type ResponsiveColumn } from '@/components/table/ResponsiveTable'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
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

export function ProjectsList() {
  const { user } = useAuth()
  const [createOpen, setCreateOpen] = useState(false)
  const queryClient = useQueryClient()

  // Pass C (deferred item #3): the Dashboard's "Active Projects" KPI
  // links here with `?status=Active` -- read once on mount so that deep
  // link actually pre-filters instead of silently landing unfiltered.
  const [searchParams, setSearchParams] = useSearchParams()
  const [search, setSearch] = useState('')
  const [domain, setDomain] = useState<Domain | ''>('')
  const [status, setStatus] = useState<ProjectStatus | ''>(
    (searchParams.get('status') as ProjectStatus | null) ?? '',
  )
  const [priority, setPriority] = useState<Priority | ''>('')
  const [sort, setSort] = useState('name')
  const [page, setPage] = useState(1)

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

  const projectsQuery = useQuery({
    queryKey: ['projects', { search, domain, status, priority, sort, page }],
    queryFn: () =>
      listProjects({ search, domain, status, priority, sort, page, page_size: PAGE_SIZE }),
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
  const createError = createMutation.error instanceof ApiError ? createMutation.error.message : null

  const isMobile = useIsMobile()
  const total = projectsQuery.data?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

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
      cell: (project) => <Badge tone={STATUS_TONE[project.status]}>{project.status}</Badge>,
    },
    {
      key: 'priority',
      header: 'Priority',
      headerCell: sortHeader('priority', 'Priority'),
      card: 'badge',
      cell: (project) => <Badge tone={PRIORITY_TONE[project.priority]}>{project.priority}</Badge>,
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
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Projects</h1>
        {canCreate && <Button onClick={() => setCreateOpen(true)}>New Project</Button>}
      </div>

      <FilterBar
        activeCount={[domain, status, priority].filter(Boolean).length}
        onClear={() => {
          setDomain('')
          setStatus('')
          setPriority('')
          setPage(1)
        }}
        desktopClear={false}
        primary={
          <div className="flex min-w-[200px] flex-1 flex-col gap-1.5">
            <label htmlFor="project-search" className="text-xs text-[var(--muted-foreground)]">
              Search
            </label>
            <Input
              id="project-search"
              type="search"
              inputMode="search"
              enterKeyHint="search"
              placeholder="Search by name…"
              value={search}
              onChange={(e) => resetToFirstPage(setSearch)(e.target.value)}
            />
          </div>
        }
      >
        <div className="flex flex-col gap-1.5">
          <label htmlFor="filter-domain" className="text-xs text-[var(--muted-foreground)]">
            Domain
          </label>
          <Select
            id="filter-domain"
            className="w-36"
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
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="filter-status" className="text-xs text-[var(--muted-foreground)]">
            Status
          </label>
          <Select
            id="filter-status"
            className="w-36"
            value={status}
            onChange={(e) => resetToFirstPage(setStatus)(e.target.value as ProjectStatus | '')}
          >
            <option value="">All statuses</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="filter-priority" className="text-xs text-[var(--muted-foreground)]">
            Priority
          </label>
          <Select
            id="filter-priority"
            className="w-36"
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
        </div>
        {isMobile && (
          <div className="flex flex-col gap-1.5">
            <label htmlFor="sort-projects" className="text-xs text-[var(--muted-foreground)]">
              Sort by
            </label>
            <Select
              id="sort-projects"
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
          </div>
        )}
      </FilterBar>

      <ResponsiveTable
        label="Projects"
        rows={projectsQuery.data?.items ?? []}
        rowKey={(p) => p.id}
        columns={columns}
        loading={projectsQuery.isLoading}
        stateCellClassName="px-4"
        state={
          projectsQuery.data?.items.length === 0 ? (
            <p className="py-6 text-center text-sm text-[var(--muted-foreground)]">
              No projects match these filters.
            </p>
          ) : undefined
        }
      />

      {total > 0 && (
        <div className="flex items-center justify-between text-xs text-[var(--muted-foreground)]">
          <span>
            Page {page} of {totalPages} ({total} project{total === 1 ? '' : 's'})
          </span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            >
              Next
            </Button>
          </div>
        </div>
      )}

      <Dialog open={createOpen} onClose={() => setCreateOpen(false)} title="New Project">
        <ProjectForm
          inDialog
          defaultValues={DEFAULT_VALUES}
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
