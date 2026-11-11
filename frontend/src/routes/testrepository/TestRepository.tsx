import { useMemo, useState } from 'react'
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useSearchParams } from 'react-router-dom'

import { ApiError } from '@/api/client'
import { listProjects, type Project } from '@/api/projects'
import {
  approveTestCase,
  createTestCase,
  deleteTestCase,
  deprecateTestCase,
  listTestCases,
  submitForReview,
  type Priority,
  type TestCase,
  type TestCaseCreateRequest,
  type TestCaseStatus,
} from '@/api/testCases'
import { listModules } from '@/api/modules'
import { listUsers } from '@/api/users'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Drawer } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { TableSkeleton } from '@/components/ui/skeleton'
import { TestCaseForm, type TestCaseFormValues } from '@/routes/testcases/TestCaseForm'
import { useToast } from '@/lib/toast'
import { STATUS_DISPLAY, priorityTone } from '@/routes/testcases/statusDisplay'

const PRIORITIES: Priority[] = ['Low', 'Medium', 'High', 'Critical']
const STATUSES: TestCaseStatus[] = ['draft', 'ready_for_review', 'approved', 'deprecated']

const DEFAULT_FORM_VALUES: TestCaseFormValues = {
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

// The one inline next-action each status has (BRD: "inline actions" --
// advance a case's lifecycle without opening its detail page). Terminal
// states (deprecated) get none.
const NEXT_ACTION: Partial<Record<TestCaseStatus, { label: string; bulkLabel: string }>> = {
  draft: { label: 'Submit', bulkLabel: 'Submit for Review' },
  ready_for_review: { label: 'Approve', bulkLabel: 'Approve' },
  approved: { label: 'Deprecate', bulkLabel: 'Deprecate' },
}

async function runNextAction(tc: TestCase): Promise<void> {
  if (tc.status === 'draft') await submitForReview(tc.id)
  else if (tc.status === 'ready_for_review') await approveTestCase(tc.id)
  else if (tc.status === 'approved') await deprecateTestCase(tc.id)
}

// Cross-project repository view (BRD: "advanced filters, bulk selection,
// inline actions and quick test case creation"). No tenant-wide
// /test-cases endpoint exists on the backend -- each project's test cases
// are fetched (server-side filtered by the same search/status/priority
// params TestCasesList already uses) and merged client-side here, tagged
// with their project. Bulk/inline actions call the same existing
// single-item endpoints TestCasesList already uses, one call per selected
// row (Promise.allSettled) -- no new bulk backend endpoint, fine at this
// tenant's realistic project/case counts.
export function TestRepository() {
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  // Pass C (deferred item #3): the Dashboard's test-case KPIs link here
  // with `?status=approved` -- read once on mount so that deep link
  // actually pre-filters instead of silently landing unfiltered.
  const [searchParams] = useSearchParams()
  const [status, setStatus] = useState<TestCaseStatus | ''>(
    (searchParams.get('status') as TestCaseStatus | null) ?? '',
  )
  const [priority, setPriority] = useState<Priority | ''>('')
  // Bug #8: deprecated cases cluttered the list by default (every seeded
  // case here happened to be deprecated) -- hidden unless explicitly
  // toggled on, or unless the status filter itself is set to Deprecated.
  const [showDeprecated, setShowDeprecated] = useState(false)
  const [projectId, setProjectId] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [bulkMessage, setBulkMessage] = useState<string | null>(null)
  const [bulkPending, setBulkPending] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [createProjectId, setCreateProjectId] = useState('')
  const { show: showToast } = useToast()

  const projectsQuery = useQuery({
    queryKey: ['projects', 'all'],
    queryFn: () => listProjects({ page_size: 100 }),
  })
  const usersQuery = useQuery({ queryKey: ['users'], queryFn: listUsers })
  const createModulesQuery = useQuery({
    queryKey: ['test-modules', createProjectId],
    queryFn: () => listModules(createProjectId),
    enabled: !!createProjectId,
  })

  const projects = projectsQuery.data?.items ?? []
  const targetProjects = projectId ? projects.filter((p) => p.id === projectId) : projects

  const perProjectQueries = useQueries({
    queries: targetProjects.map((project) => ({
      queryKey: ['test-repository', project.id, { search, status, priority }],
      queryFn: () =>
        listTestCases(project.id, { search, status, priority, page_size: 100 }).then((r) => ({
          project,
          items: r.items,
        })),
      enabled: targetProjects.length > 0,
    })),
  })

  const usersById = useMemo(
    () => new Map((usersQuery.data ?? []).map((u) => [u.id, u.name])),
    [usersQuery.data],
  )

  const isLoading = perProjectQueries.some((q) => q.isLoading)
  const allRows: { project: Project; case: TestCase }[] = perProjectQueries
    .flatMap((q) => (q.data ? q.data.items.map((c) => ({ project: q.data!.project, case: c })) : []))
    .sort((a, b) => b.case.created_at.localeCompare(a.case.created_at))
  const rows = allRows.filter(
    (r) => showDeprecated || status === 'deprecated' || r.case.status !== 'deprecated',
  )
  const hiddenDeprecatedCount = allRows.length - rows.length

  function invalidateRepository() {
    queryClient.invalidateQueries({ predicate: (q) => q.queryKey[0] === 'test-repository' })
  }

  function toggleRow(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleAll() {
    setSelected((prev) => (prev.size === rows.length ? new Set() : new Set(rows.map((r) => r.case.id))))
  }

  const inlineActionMutation = useMutation({
    mutationFn: (tc: TestCase) => runNextAction(tc),
    onSuccess: () => {
      invalidateRepository()
      showToast('success', 'Test case updated')
    },
    // This mutation previously had no error handling at all -- a failed
    // inline action (e.g. an invalid status transition) failed completely
    // silently. Added as part of the app-wide toast sweep (GAP-90).
    onError: (err) =>
      showToast('error', err instanceof ApiError ? err.message : 'Could not update that test case'),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteTestCase(id),
    onSuccess: () => {
      invalidateRepository()
      showToast('success', 'Test case deleted')
    },
    // Same previously-silent-failure gap as inlineActionMutation above.
    onError: (err) =>
      showToast('error', err instanceof ApiError ? err.message : 'Could not delete that test case'),
  })

  const createMutation = useMutation({
    mutationFn: (req: TestCaseCreateRequest) => createTestCase(createProjectId, req),
    onSuccess: () => {
      invalidateRepository()
      setCreateOpen(false)
      showToast('success', 'Test case created')
    },
    // No onError toast -- `createError` below already renders this inline.
  })
  const createError = createMutation.error instanceof ApiError ? createMutation.error.message : null

  async function runBulk(kind: 'next-action' | 'delete') {
    const targets = rows.filter((r) => selected.has(r.case.id))
    if (targets.length === 0) return
    setBulkPending(true)
    setBulkMessage(null)
    const results = await Promise.allSettled(
      targets.map((r) => (kind === 'delete' ? deleteTestCase(r.case.id) : runNextAction(r.case))),
    )
    const succeeded = results.filter((r) => r.status === 'fulfilled').length
    const failed = results.length - succeeded
    setBulkMessage(
      failed === 0
        ? `${succeeded} test case${succeeded === 1 ? '' : 's'} updated.`
        : `${succeeded} succeeded, ${failed} failed (likely not a valid transition for that case's current status, or a permission check).`,
    )
    setSelected(new Set())
    setBulkPending(false)
    invalidateRepository()
  }

  const selectedRows = rows.filter((r) => selected.has(r.case.id))

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Test Repository</h1>
        {/* Bug #11: previously defaulted to projects[0] when viewing "All
            projects" -- silently created the case in whichever project
            happened to sort first. Now defaults to unselected (forcing an
            explicit choice) unless the list is already filtered to one
            specific project. */}
        <Button onClick={() => { setCreateProjectId(projectId); setCreateOpen(true) }} disabled={projects.length === 0}>
          New Test Case
        </Button>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="flex min-w-[220px] flex-1 flex-col gap-1.5">
          <label htmlFor="repo-search" className="text-xs text-[var(--muted-foreground)]">
            Search
          </label>
          <Input
            id="repo-search"
            placeholder="Search by title across all projects…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="repo-project" className="text-xs text-[var(--muted-foreground)]">
            Project
          </label>
          <Select
            id="repo-project"
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
        <div className="flex flex-col gap-1.5">
          <label htmlFor="repo-status" className="text-xs text-[var(--muted-foreground)]">
            Status
          </label>
          <Select
            id="repo-status"
            className="w-40"
            value={status}
            onChange={(e) => setStatus(e.target.value as TestCaseStatus | '')}
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
          <label htmlFor="repo-priority" className="text-xs text-[var(--muted-foreground)]">
            Priority
          </label>
          <Select
            id="repo-priority"
            className="w-36"
            value={priority}
            onChange={(e) => setPriority(e.target.value as Priority | '')}
          >
            <option value="">All priorities</option>
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </Select>
        </div>
        <label className="flex items-center gap-2 pb-2 text-sm">
          <input
            type="checkbox"
            checked={showDeprecated}
            onChange={(e) => setShowDeprecated(e.target.checked)}
          />
          Show deprecated
        </label>
      </div>

      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-md border border-[var(--border)] bg-[var(--muted)] px-3 py-2 text-sm">
          <span className="font-medium">{selected.size} selected</span>
          <Button size="sm" variant="outline" disabled={bulkPending} onClick={() => runBulk('next-action')}>
            Advance status
          </Button>
          <Button size="sm" variant="destructive" disabled={bulkPending} onClick={() => runBulk('delete')}>
            Delete
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
            Clear selection
          </Button>
        </div>
      )}
      {bulkMessage && <p className="text-xs text-[var(--muted-foreground)]">{bulkMessage}</p>}

      <div className="overflow-x-auto rounded-lg border border-[var(--border)] bg-[var(--background)]">
        <table className="w-full text-sm">
          <thead className="bg-[var(--muted)] text-left text-xs text-[var(--muted-foreground)]">
            <tr>
              <th className="w-10 px-4 py-2">
                <input
                  type="checkbox"
                  aria-label="Select all"
                  checked={rows.length > 0 && selected.size === rows.length}
                  onChange={toggleAll}
                />
              </th>
              <th className="px-4 py-2 font-medium">Title</th>
              <th className="px-4 py-2 font-medium">Project</th>
              <th className="px-4 py-2 font-medium">Status</th>
              <th className="px-4 py-2 font-medium">Priority</th>
              <th className="px-4 py-2 font-medium">Assignee</th>
              <th className="px-4 py-2 font-medium">Steps</th>
              <th className="px-4 py-2 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {!isLoading && rows.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-6 text-center text-[var(--muted-foreground)]">
                  {hiddenDeprecatedCount > 0
                    ? `No test cases match these filters — ${hiddenDeprecatedCount} deprecated case${hiddenDeprecatedCount === 1 ? '' : 's'} hidden, check "Show deprecated".`
                    : 'No test cases match these filters.'}
                </td>
              </tr>
            )}
            {isLoading && <TableSkeleton columns={7} />}
            {rows.map(({ project, case: tc }) => {
              const nextAction = NEXT_ACTION[tc.status]
              return (
                <tr key={tc.id} className="border-t border-[var(--border)] hover:bg-[var(--muted)]">
                  <td className="px-4 py-2">
                    <input
                      type="checkbox"
                      aria-label={`Select ${tc.title}`}
                      checked={selected.has(tc.id)}
                      onChange={() => toggleRow(tc.id)}
                    />
                  </td>
                  <td className="px-4 py-2">
                    <Link to={`/test-cases/${tc.id}`} className="font-medium underline-offset-2 hover:underline">
                      {tc.title}
                    </Link>
                  </td>
                  <td className="px-4 py-2">
                    <Link
                      to={`/projects/${project.id}/test-cases`}
                      className="text-[var(--muted-foreground)] hover:underline"
                    >
                      {project.name}
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
                  <td className="px-4 py-2">{tc.steps.length}</td>
                  <td className="px-4 py-2 text-right">
                    <div className="flex justify-end gap-1.5">
                      {nextAction && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={inlineActionMutation.isPending}
                          onClick={() => inlineActionMutation.mutate(tc)}
                        >
                          {nextAction.label}
                        </Button>
                      )}
                      {tc.status === 'draft' && (
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={deleteMutation.isPending}
                          onClick={() => deleteMutation.mutate(tc.id)}
                        >
                          Delete
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {rows.length > 0 && (
        <p className="text-xs text-[var(--muted-foreground)]">
          {rows.length} test case{rows.length === 1 ? '' : 's'} across {targetProjects.length} project
          {targetProjects.length === 1 ? '' : 's'}
          {selectedRows.length > 0 ? ` · ${selectedRows.length} selected` : ''}.
        </p>
      )}

      {/* GAP-91 item 1: a 10+ field form no longer fits well in a centered
          Dialog -- a full-height Drawer gives it real room. */}
      <Drawer open={createOpen} onClose={() => setCreateOpen(false)} title="New Test Case">
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="create-project">
              Project <span className="text-[var(--destructive)]">*</span>
            </Label>
            <Select
              id="create-project"
              required
              value={createProjectId}
              onChange={(e) => setCreateProjectId(e.target.value)}
            >
              <option value="" disabled>
                Select a project…
              </option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </div>
          {createProjectId ? (
            <TestCaseForm
              defaultValues={DEFAULT_FORM_VALUES}
              submitLabel="Create Test Case"
              isSubmitting={createMutation.isPending}
              serverError={createError}
              users={usersQuery.data ?? []}
              modules={createModulesQuery.data ?? []}
              onSubmit={(values) => createMutation.mutate(values)}
            />
          ) : (
            <p className="text-sm text-[var(--muted-foreground)]">
              Choose a project above to continue.
            </p>
          )}
        </div>
      </Drawer>
    </div>
  )
}
