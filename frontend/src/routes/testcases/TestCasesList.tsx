import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { Link, useParams } from 'react-router-dom'

import { ApiError } from '@/api/client'
import { exportUrl } from '@/api/csvImport'
import { createModule, deleteModule, listModules } from '@/api/modules'
import { getProject } from '@/api/projects'
import {
  assignModule,
  createTestCase,
  listTestCases,
  type Priority,
  type TestCaseCreateRequest,
  type TestCaseStatus,
} from '@/api/testCases'
import { listUsers } from '@/api/users'
import { listFieldOptions } from '@/api/fieldCustomization'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { useToast } from '@/lib/toast'
import { ImportDialog } from './ImportDialog'
import { TemplatesDialog } from './TemplatesDialog'
import { TestCaseForm, type TestCaseFormValues } from './TestCaseForm'
import { STATUS_DISPLAY, priorityTone } from './statusDisplay'

const DEFAULT_VALUES: TestCaseFormValues = {
  title: '',
  module_id: '',
  description: '',
  priority: 'Medium',
  assignee_id: '',
  scenario_id: '',
  scenario_description: '',
  prerequisite: '',
  test_data: '',
  steps: [{ action: '', expected: '' }],
}

const PRIORITIES: Priority[] = ['Low', 'Medium', 'High', 'Critical']
const STATUSES: TestCaseStatus[] = ['draft', 'ready_for_review', 'approved', 'deprecated']
const PAGE_SIZE = 10

const COLUMNS: { key: string; label: string; sortable: boolean }[] = [
  { key: 'title', label: 'Title', sortable: true },
  { key: 'status', label: 'Status', sortable: true },
  { key: 'priority', label: 'Priority', sortable: true },
  { key: 'assignee', label: 'Assignee', sortable: false },
  { key: 'module', label: 'Module', sortable: false },
  { key: 'version', label: 'Version', sortable: false },
  { key: 'steps', label: 'Steps', sortable: false },
]

export function TestCasesList() {
  const { projectId } = useParams<{ projectId: string }>()
  const [createOpen, setCreateOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [templatesOpen, setTemplatesOpen] = useState(false)
  const [modulesOpen, setModulesOpen] = useState(false)
  const [newModuleName, setNewModuleName] = useState('')
  const queryClient = useQueryClient()
  const { show: showToast } = useToast()

  const [search, setSearch] = useState('')
  const [priority, setPriority] = useState<Priority | ''>('')
  const [status, setStatus] = useState<TestCaseStatus | ''>('')
  const [assigneeId, setAssigneeId] = useState('')
  const [moduleId, setModuleId] = useState('')
  const [sort, setSort] = useState('created_at')
  const [page, setPage] = useState(1)

  // Gap-closure pass (ADR-057): the priority filter must reflect this
  // tenant's actual configured value set (Tier 5 / ADR-055), the same
  // source TestCaseForm's create/edit priority field already uses --
  // falls back to the fixed PRIORITIES list only while this is loading.
  const priorityOptionsQuery = useQuery({
    queryKey: ['field-options', 'test_case_priority'],
    queryFn: () => listFieldOptions('test_case_priority'),
  })
  const priorityFilterOptions: { code: string; label: string }[] = priorityOptionsQuery.data?.length
    ? priorityOptionsQuery.data.map((o) => ({ code: o.code, label: o.label }))
    : PRIORITIES.map((p) => ({ code: p, label: p }))

  const projectQuery = useQuery({
    queryKey: ['projects', projectId],
    queryFn: () => getProject(projectId!),
    enabled: !!projectId,
  })
  const usersQuery = useQuery({ queryKey: ['users'], queryFn: listUsers })
  const modulesQuery = useQuery({
    queryKey: ['test-modules', projectId],
    queryFn: () => listModules(projectId!),
    enabled: !!projectId,
  })
  const testCasesQuery = useQuery({
    queryKey: ['test-cases', projectId, { search, priority, status, assigneeId, moduleId, sort, page }],
    queryFn: () =>
      listTestCases(projectId!, {
        search,
        priority,
        status,
        assignee_id: assigneeId,
        module_id: moduleId || undefined,
        sort,
        page,
        page_size: PAGE_SIZE,
      }),
    enabled: !!projectId,
  })

  const createMutation = useMutation({
    mutationFn: (req: TestCaseCreateRequest) => createTestCase(projectId!, req),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['test-cases', projectId] })
      setCreateOpen(false)
    },
  })

  const assignModuleMutation = useMutation({
    mutationFn: ({ id, module }: { id: string; module: string | null }) => assignModule(id, module),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['test-cases', projectId] }),
    onError: (err) =>
      showToast('error', err instanceof ApiError ? err.message : 'Could not assign module'),
  })

  const createModuleMutation = useMutation({
    mutationFn: () => createModule(projectId!, { name: newModuleName }),
    onSuccess: () => {
      setNewModuleName('')
      queryClient.invalidateQueries({ queryKey: ['test-modules', projectId] })
    },
    onError: (err) =>
      showToast('error', err instanceof ApiError ? err.message : 'Could not create module'),
  })

  const deleteModuleMutation = useMutation({
    mutationFn: (id: string) => deleteModule(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['test-modules', projectId] })
      queryClient.invalidateQueries({ queryKey: ['test-cases', projectId] })
    },
  })

  const createError = createMutation.error instanceof ApiError ? createMutation.error.message : null
  const usersById = new Map((usersQuery.data ?? []).map((u) => [u.id, u.name]))
  const modules = modulesQuery.data ?? []

  const total = testCasesQuery.data?.total ?? 0
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
        <div>
          <Link to={`/projects/${projectId}`} className="text-xs text-[var(--muted-foreground)] hover:underline">
            ← {projectQuery.data?.name ?? 'Project'}
          </Link>
          <h1 className="text-lg font-semibold">Test Cases</h1>
        </div>
        <div className="flex gap-2">
          <a
            href={exportUrl(projectId!)}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-8 items-center rounded-md border border-[var(--border)] px-3 text-sm hover:bg-[var(--muted)]"
          >
            Export CSV
          </a>
          <Button variant="outline" size="sm" onClick={() => setImportOpen(true)}>
            Import CSV
          </Button>
          <Button variant="outline" size="sm" onClick={() => setModulesOpen(true)}>
            Manage Modules
          </Button>
          <Button variant="outline" size="sm" onClick={() => setTemplatesOpen(true)}>
            Templates
          </Button>
          <Button onClick={() => setCreateOpen(true)}>New Test Case</Button>
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="flex min-w-[200px] flex-1 flex-col gap-1.5">
          <label htmlFor="tc-search" className="text-xs text-[var(--muted-foreground)]">
            Search
          </label>
          <Input
            id="tc-search"
            placeholder="Search by title…"
            value={search}
            onChange={(e) => resetToFirstPage(setSearch)(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="tc-filter-status" className="text-xs text-[var(--muted-foreground)]">
            Status
          </label>
          <Select
            id="tc-filter-status"
            className="w-40"
            value={status}
            onChange={(e) => resetToFirstPage(setStatus)(e.target.value as TestCaseStatus | '')}
          >
            <option value="">All statuses</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_DISPLAY[s].label}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="tc-filter-priority" className="text-xs text-[var(--muted-foreground)]">
            Priority
          </label>
          <Select
            id="tc-filter-priority"
            className="w-36"
            value={priority}
            onChange={(e) => resetToFirstPage(setPriority)(e.target.value as Priority | '')}
          >
            <option value="">All priorities</option>
            {priorityFilterOptions.map((p) => (
              <option key={p.code} value={p.code}>
                {p.label}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="tc-filter-assignee" className="text-xs text-[var(--muted-foreground)]">
            Assignee
          </label>
          <Select
            id="tc-filter-assignee"
            className="w-40"
            value={assigneeId}
            onChange={(e) => resetToFirstPage(setAssigneeId)(e.target.value)}
          >
            <option value="">All assignees</option>
            {(usersQuery.data ?? []).map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="tc-filter-module" className="text-xs text-[var(--muted-foreground)]">
            Module
          </label>
          <Select
            id="tc-filter-module"
            className="w-40"
            value={moduleId}
            onChange={(e) => resetToFirstPage(setModuleId)(e.target.value)}
          >
            <option value="">All modules</option>
            {modules.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
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
            {testCasesQuery.data?.items.length === 0 && (
              <tr>
                <td colSpan={COLUMNS.length} className="px-4 py-6 text-center text-[var(--muted-foreground)]">
                  No test cases match these filters.
                </td>
              </tr>
            )}
            {testCasesQuery.data?.items.map((tc) => (
              <tr key={tc.id} className="border-t border-[var(--border)] hover:bg-[var(--muted)]">
                <td className="px-4 py-2">
                  <Link to={`/test-cases/${tc.id}`} className="font-medium underline-offset-2 hover:underline">
                    {tc.title}
                  </Link>
                </td>
                <td className="px-4 py-2">
                  <Badge tone={STATUS_DISPLAY[tc.status].tone}>{tc.status_label}</Badge>
                </td>
                <td className="px-4 py-2">
                  <Badge tone={priorityTone(tc.priority)}>{tc.priority}</Badge>
                </td>
                <td className="px-4 py-2 text-[var(--muted-foreground)]">
                  {tc.assignee_id ? (usersById.get(tc.assignee_id) ?? 'Unknown') : '—'}
                </td>
                <td className="px-4 py-2">
                  <Select
                    className="h-7 w-36 text-xs"
                    value={tc.module_id ?? ''}
                    onChange={(e) =>
                      assignModuleMutation.mutate({ id: tc.id, module: e.target.value || null })
                    }
                  >
                    <option value="">Ungrouped</option>
                    {modules.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </Select>
                </td>
                <td className="px-4 py-2">v{tc.version_number}</td>
                <td className="px-4 py-2">{tc.steps.length}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {total > 0 && (
        <div className="flex items-center justify-between text-xs text-[var(--muted-foreground)]">
          <span>
            Page {page} of {totalPages} ({total} test case{total === 1 ? '' : 's'})
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

      <Dialog open={createOpen} onClose={() => setCreateOpen(false)} title="New Test Case" className="max-w-2xl">
        <TestCaseForm
          defaultValues={DEFAULT_VALUES}
          submitLabel="Create Test Case"
          isSubmitting={createMutation.isPending}
          serverError={createError}
          users={usersQuery.data ?? []}
          modules={modulesQuery.data ?? []}
          onSubmit={(values) => createMutation.mutate(values)}
        />
      </Dialog>

      <ImportDialog open={importOpen} onClose={() => setImportOpen(false)} projectId={projectId!} />
      <TemplatesDialog open={templatesOpen} onClose={() => setTemplatesOpen(false)} projectId={projectId!} />

      <Dialog open={modulesOpen} onClose={() => setModulesOpen(false)} title="Manage Modules">
        <div className="flex flex-col gap-3 text-sm">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="new-module-name">New module name</Label>
            <div className="flex gap-2">
              <Input
                id="new-module-name"
                value={newModuleName}
                onChange={(e) => setNewModuleName(e.target.value)}
              />
              <Button
                size="sm"
                disabled={createModuleMutation.isPending || newModuleName.trim().length === 0}
                onClick={() => createModuleMutation.mutate()}
              >
                Add
              </Button>
            </div>
          </div>
          <ul className="flex flex-col gap-1">
            {modules.length === 0 && (
              <li className="text-xs text-[var(--muted-foreground)]">No modules yet.</li>
            )}
            {modules.map((m) => (
              <li
                key={m.id}
                className="flex items-center justify-between rounded-md border border-[var(--border)] px-3 py-2"
              >
                <span>
                  {m.name}{' '}
                  <span className="text-xs text-[var(--muted-foreground)]">
                    ({m.test_case_count} test case{m.test_case_count === 1 ? '' : 's'})
                  </span>
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={deleteModuleMutation.isPending}
                  onClick={() => deleteModuleMutation.mutate(m.id)}
                >
                  Delete
                </Button>
              </li>
            ))}
          </ul>
        </div>
      </Dialog>
    </div>
  )
}
