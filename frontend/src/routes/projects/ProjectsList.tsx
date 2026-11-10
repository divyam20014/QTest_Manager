import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { Link } from 'react-router-dom'

import { ApiError } from '@/api/client'
import {
  createProject,
  listProjects,
  type Domain,
  type Priority,
  type ProjectCreateRequest,
  type ProjectStatus,
} from '@/api/projects'
import { listUsers } from '@/api/users'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { useAuth } from '@/lib/auth'
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

const COLUMNS: { key: string; label: string; sortable: boolean }[] = [
  { key: 'name', label: 'Name', sortable: true },
  { key: 'domain', label: 'Domain', sortable: false },
  { key: 'status', label: 'Status', sortable: true },
  { key: 'priority', label: 'Priority', sortable: true },
  { key: 'manager_name', label: 'Manager', sortable: false },
  { key: 'region', label: 'Region', sortable: false },
  { key: 'metrics', label: 'Test Cases / Runs / Open Defects', sortable: false },
]

export function ProjectsList() {
  const { user } = useAuth()
  const [createOpen, setCreateOpen] = useState(false)
  const queryClient = useQueryClient()

  const [search, setSearch] = useState('')
  const [domain, setDomain] = useState<Domain | ''>('')
  const [status, setStatus] = useState<ProjectStatus | ''>('')
  const [priority, setPriority] = useState<Priority | ''>('')
  const [sort, setSort] = useState('name')
  const [page, setPage] = useState(1)

  const projectsQuery = useQuery({
    queryKey: ['projects', { search, domain, status, priority, sort, page }],
    queryFn: () =>
      listProjects({ search, domain, status, priority, sort, page, page_size: PAGE_SIZE }),
  })

  const createMutation = useMutation({
    mutationFn: (req: ProjectCreateRequest) => createProject(req),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] })
      setCreateOpen(false)
    },
  })

  const canCreate = user?.role === 'admin' || user?.role === 'manager'
  const usersQuery = useQuery({ queryKey: ['users'], queryFn: listUsers, enabled: canCreate })
  const createError = createMutation.error instanceof ApiError ? createMutation.error.message : null

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

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Projects</h1>
        {canCreate && <Button onClick={() => setCreateOpen(true)}>New Project</Button>}
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="flex min-w-[200px] flex-1 flex-col gap-1.5">
          <label htmlFor="project-search" className="text-xs text-[var(--muted-foreground)]">
            Search
          </label>
          <Input
            id="project-search"
            placeholder="Search by name…"
            value={search}
            onChange={(e) => resetToFirstPage(setSearch)(e.target.value)}
          />
        </div>
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
      </div>

      <div className="overflow-x-auto rounded-lg border border-[var(--border)]">
        <table className="w-full text-sm">
          <thead className="bg-[var(--muted)] text-left text-xs text-[var(--muted-foreground)]">
            <tr>
              {COLUMNS.map((col) => {
                const isActive = sort.replace(/^-/, '') === col.key
                return (
                  <th key={col.key} className="px-4 py-2 font-medium">
                    {col.sortable ? (
                      <button
                        type="button"
                        className="flex items-center gap-1 hover:text-[var(--foreground)]"
                        onClick={() => toggleSort(col.key)}
                      >
                        {col.label}
                        {isActive &&
                          (sort.startsWith('-') ? (
                            <ChevronDown className="size-3.5" />
                          ) : (
                            <ChevronUp className="size-3.5" />
                          ))}
                      </button>
                    ) : (
                      col.label
                    )}
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {projectsQuery.data?.items.length === 0 && (
              <tr>
                <td
                  colSpan={COLUMNS.length}
                  className="px-4 py-6 text-center text-[var(--muted-foreground)]"
                >
                  No projects match these filters.
                </td>
              </tr>
            )}
            {projectsQuery.data?.items.map((project) => (
              <tr key={project.id} className="border-t border-[var(--border)] hover:bg-[var(--muted)]">
                <td className="px-4 py-2">
                  <Link
                    to={`/projects/${project.id}`}
                    className="font-medium underline-offset-2 hover:underline"
                  >
                    {project.name}
                  </Link>
                </td>
                <td className="px-4 py-2">{project.domain}</td>
                <td className="px-4 py-2">
                  <Badge tone={STATUS_TONE[project.status]}>{project.status}</Badge>
                </td>
                <td className="px-4 py-2">
                  <Badge tone={PRIORITY_TONE[project.priority]}>{project.priority}</Badge>
                </td>
                <td className="px-4 py-2">{project.manager_name}</td>
                <td className="px-4 py-2">{project.region}</td>
                <td className="px-4 py-2 text-[var(--muted-foreground)]">
                  {project.test_case_count} ({project.approved_test_case_count} approved) /{' '}
                  {project.test_run_count} / {project.open_defect_count}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

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
