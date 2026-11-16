import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'

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
import { StatusBadge } from '@/components/ui/StatusBadge'
import { PageHeader } from '@/components/ui/PageHeader'
import { Button } from '@/components/ui/button'
import { useConfirm } from '@/components/ui/useConfirm'
import { Drawer } from '@/components/ui/dialog'
import { ErrorState } from '@/components/ui/empty-state'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { ColumnVisibilityMenu } from '@/components/table/ColumnVisibilityMenu'
import { FilterBar } from '@/components/table/FilterBar'
import { CARD_LINK_CLASS, ResponsiveTable, type ResponsiveColumn } from '@/components/table/ResponsiveTable'
import { useRowContextMenu, type RowContextMenuItem } from '@/components/table/RowContextMenu'
import { SavedFiltersMenu } from '@/components/table/SavedFiltersMenu'
import { useColumnPrefs, useSavedFilters, type TableColumnDef } from '@/components/table/tablePrefs'
import { TestCaseForm, type TestCaseFormValues } from '@/routes/testcases/TestCaseForm'
import { useToast } from '@/lib/toast'
import { STATUS_DISPLAY, priorityTone } from '@/routes/testcases/statusDisplay'

const REPO_COLUMNS: TableColumnDef[] = [
  { key: 'title', label: 'Title', alwaysVisible: true, defaultWidth: 280 },
  { key: 'project', label: 'Project', defaultWidth: 160 },
  { key: 'status', label: 'Status', alwaysVisible: true, defaultWidth: 140 },
  { key: 'priority', label: 'Priority', defaultWidth: 110 },
  { key: 'assignee', label: 'Assignee', defaultWidth: 140 },
  { key: 'steps', label: 'Steps', defaultWidth: 80 },
]

// The API caps page_size at 100 and returns `total`. Each project loads 50 at a
// time and "Load more" fetches the next page for every project that still has
// cases it has not shown -- nothing is silently cut off.
const PAGE_SIZE = 50

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
  const navigate = useNavigate()
  const [search, setSearch] = useState('')
  // Pass C (deferred item #3): the Dashboard's test-case KPIs link here
  // with `?status=approved` -- read once on mount so that deep link
  // actually pre-filters instead of silently landing unfiltered.
  const [searchParams, setSearchParams] = useSearchParams()
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
  const { ask, dialog: confirmDialog } = useConfirm()
  // Pages beyond the first, per project (see PAGE_SIZE).
  const [extra, setExtra] = useState<Record<string, { page: number; items: TestCase[] }>>({})
  const [loadingMore, setLoadingMore] = useState(false)
  const filterSignature = JSON.stringify([search, status, priority, projectId])
  const filterSignatureRef = useRef(filterSignature)
  filterSignatureRef.current = filterSignature
  useEffect(() => {
    setExtra({})
  }, [filterSignature])

  // Phase 2: the command palette's "Create Test Case" quick action
  // navigates here with ?action=create -- reuses this existing create
  // drawer rather than inventing a new creation flow.
  useEffect(() => {
    if (searchParams.get('action') === 'create') {
      setCreateProjectId(projectId)
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
  const columnPrefs = useColumnPrefs('test-repository', REPO_COLUMNS)
  const savedFilters = useSavedFilters<Record<string, string>>('test-repository')
  const rowMenu = useRowContextMenu()

  const currentFilters = {
    search,
    status,
    priority,
    projectId,
    showDeprecated: showDeprecated ? 'true' : 'false',
  }
  function applyFilters(f: Record<string, string>) {
    setSearch(f.search ?? '')
    setStatus((f.status as TestCaseStatus | '') ?? '')
    setPriority((f.priority as Priority | '') ?? '')
    setProjectId(f.projectId ?? '')
    setShowDeprecated(f.showDeprecated === 'true')
  }

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
        listTestCases(project.id, { search, status, priority, page_size: PAGE_SIZE }).then((r) => ({
          project,
          items: r.items,
          total: r.total,
        })),
      enabled: targetProjects.length > 0,
    })),
  })

  const usersById = useMemo(
    () => new Map((usersQuery.data ?? []).map((u) => [u.id, u.name])),
    [usersQuery.data],
  )

  const isLoading = perProjectQueries.some((q) => q.isLoading)
  const failedCount = perProjectQueries.filter((q) => q.isError).length
  const allRows: { project: Project; case: TestCase }[] = perProjectQueries
    .flatMap((q) => {
      if (!q.data) return []
      const seen = new Set<string>()
      return [...q.data.items, ...(extra[q.data.project.id]?.items ?? [])]
        .filter((c) => (seen.has(c.id) ? false : (seen.add(c.id), true)))
        .map((c) => ({ project: q.data!.project, case: c }))
    })
    .sort((a, b) => b.case.created_at.localeCompare(a.case.created_at))
  // How much of what the server holds is on screen.
  const totalAvailable = perProjectQueries.reduce((sum, q) => sum + (q.data?.total ?? 0), 0)
  const hasMore = allRows.length < totalAvailable

  async function loadMore() {
    const signature = filterSignatureRef.current
    setLoadingMore(true)
    const targets = perProjectQueries
      .map((q) => q.data)
      .filter((d): d is NonNullable<typeof d> => !!d)
      .filter((d) => d.items.length + (extra[d.project.id]?.items.length ?? 0) < d.total)
    const results = await Promise.allSettled(
      targets.map(async (d) => {
        const page = (extra[d.project.id]?.page ?? 1) + 1
        const r = await listTestCases(d.project.id, { search, status, priority, page_size: PAGE_SIZE, page })
        return { id: d.project.id, page, items: r.items }
      }),
    )
    setLoadingMore(false)
    // The filters changed while this was loading: those rows belong to a
    // different result set, so drop them.
    if (signature !== filterSignatureRef.current) return
    setExtra((prev) => {
      const next = { ...prev }
      for (const res of results) {
        if (res.status !== 'fulfilled') continue
        const { id, page, items } = res.value
        next[id] = { page, items: [...(next[id]?.items ?? []), ...items] }
      }
      return next
    })
    if (results.some((r) => r.status === 'rejected')) {
      showToast('error', 'Some test cases could not be loaded. Try “Load more” again.')
    }
  }
  const rows = allRows.filter(
    (r) => showDeprecated || status === 'deprecated' || r.case.status !== 'deprecated',
  )
  const hiddenDeprecatedCount = allRows.length - rows.length

  function invalidateRepository() {
    // Back to the first page: rows loaded by "Load more" may have been deleted
    // or changed, and the refetch only covers the first page of each project.
    setExtra({})
    queryClient.invalidateQueries({ predicate: (q) => q.queryKey[0] === 'test-repository' })
  }

  // Deprecating is one-way (there is no "un-deprecate"), so it is confirmed;
  // the other lifecycle steps (Submit, Approve) are reversible and are not.
  function advance(tc: TestCase) {
    if (tc.status !== 'approved') {
      inlineActionMutation.mutate(tc)
      return
    }
    ask({
      title: 'Deprecate this test case?',
      description: `“${tc.title}” is retired: it can no longer be added to new runs and cannot be returned to Approved.`,
      confirmLabel: 'Deprecate',
      run: () => inlineActionMutation.mutateAsync(tc),
    })
  }

  function confirmDelete(tc: TestCase) {
    ask({
      title: 'Delete this test case?',
      description: `“${tc.title}” and its steps are permanently deleted. This cannot be undone.`,
      confirmLabel: 'Delete test case',
      run: () => deleteMutation.mutateAsync(tc.id),
    })
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

  // One definition feeds the desktop table and the phone cards (ResponsiveTable).
  type Row = { project: Project; case: TestCase }
  const tableColumns: ResponsiveColumn<Row>[] = [
    {
      key: 'title',
      header: 'Title',
      limitWidth: true,
      card: 'title',
      cell: ({ case: tc }) => (
        <Link to={`/test-cases/${tc.id}`} className="block truncate font-medium underline-offset-2 hover:underline">
          {tc.title}
        </Link>
      ),
      cardCell: ({ case: tc }) => (
        <Link to={`/test-cases/${tc.id}`} className={CARD_LINK_CLASS}>
          {tc.title}
        </Link>
      ),
    },
    {
      key: 'project',
      header: 'Project',
      limitWidth: true,
      cell: ({ project }) => (
        <Link
          to={`/projects/${project.id}/test-cases`}
          className="block truncate text-[var(--muted-foreground)] hover:underline"
        >
          {project.name}
        </Link>
      ),
      // A second link inside a tappable card would be a second, tiny tap target.
      cardCell: ({ project }) => project.name,
    },
    {
      key: 'status',
      header: 'Status',
      card: 'badge',
      cell: ({ case: tc }) => <StatusBadge tone={STATUS_DISPLAY[tc.status].tone}>{tc.status_label}</StatusBadge>,
    },
    {
      key: 'priority',
      header: 'Priority',
      card: 'badge',
      cell: ({ case: tc }) => <StatusBadge tone={priorityTone(tc.priority)}>{tc.priority}</StatusBadge>,
    },
    {
      key: 'assignee',
      header: 'Assignee',
      limitWidth: true,
      tdClassName: 'truncate text-[var(--muted-foreground)]',
      cell: ({ case: tc }) => (tc.assignee_id ? (usersById.get(tc.assignee_id) ?? 'Unknown') : '—'),
    },
    { key: 'steps', header: 'Steps', cell: ({ case: tc }) => tc.steps.length },
  ]

  return (
    <div className="flex flex-col gap-4">
      {/* Bug #11: previously defaulted to projects[0] when viewing "All
          projects" -- silently created the case in whichever project
          happened to sort first. Now defaults to unselected (forcing an
          explicit choice) unless the list is already filtered to one
          specific project. */}
      <PageHeader
        title="Test Repository"
        description="Every test case across your projects."
        actions={
          <Button onClick={() => { setCreateProjectId(projectId); setCreateOpen(true) }} disabled={projects.length === 0}>
            New Test Case
          </Button>
        }
      />

      <FilterBar
        activeCount={[status, priority, projectId].filter(Boolean).length + (showDeprecated ? 1 : 0)}
        desktopClear={false}
        onClear={() => {
          setStatus('')
          setPriority('')
          setProjectId('')
          setShowDeprecated(false)
        }}
        primary={
          <div className="flex min-w-[220px] flex-1 flex-col gap-1.5 max-md:min-w-0">
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
        }
        saved={
          <SavedFiltersMenu
            current={currentFilters}
            saved={savedFilters.saved}
            onSave={savedFilters.save}
            onApply={applyFilters}
            onRemove={savedFilters.remove}
          />
        }
        toolbar={
          <ColumnVisibilityMenu
            columns={REPO_COLUMNS}
            isVisible={columnPrefs.isVisible}
            toggleVisible={columnPrefs.toggleVisible}
            showAll={columnPrefs.showAll}
          />
        }
      >
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
      </FilterBar>

      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-md border border-[var(--border)] bg-[var(--muted)] px-3 py-2 text-sm max-md:sticky max-md:bottom-[calc(5rem+env(safe-area-inset-bottom))] max-md:z-30 max-md:shadow-lg">
          <span className="font-medium">{selected.size} selected</span>
          <Button
            size="sm"
            variant="outline"
            disabled={bulkPending}
            onClick={() => {
              const deprecating = selectedRows.filter((r) => r.case.status === 'approved').length
              if (deprecating === 0) {
                void runBulk('next-action')
                return
              }
              ask({
                title: `Advance ${selected.size} test case${selected.size === 1 ? '' : 's'}?`,
                description: `${deprecating} approved case${deprecating === 1 ? ' will be' : 's will be'} deprecated, which cannot be undone. The rest move to their next status.`,
                confirmLabel: 'Advance status',
                destructive: false,
                run: () => runBulk('next-action'),
              })
            }}
          >
            Advance status
          </Button>
          <Button
            size="sm"
            variant="destructive"
            disabled={bulkPending}
            onClick={() =>
              ask({
                title: `Delete ${selected.size} test case${selected.size === 1 ? '' : 's'}?`,
                description:
                  'The selected test cases and their steps are permanently deleted. Cases the server refuses to delete (for example ones that are already in a run) are reported afterwards. This cannot be undone.',
                confirmLabel: `Delete ${selected.size}`,
                run: () => runBulk('delete'),
              })
            }
          >
            Delete
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
            Clear selection
          </Button>
        </div>
      )}
      {bulkMessage && <p className="text-xs text-[var(--muted-foreground)]">{bulkMessage}</p>}

      <ResponsiveTable
        label="Test cases"
        className="bg-[var(--background)]"
        rows={rows}
        rowKey={(r) => r.case.id}
        columns={tableColumns}
        prefs={columnPrefs}
        loading={isLoading}
        stateCellClassName="px-4 py-6 text-center text-[var(--muted-foreground)]"
        state={
          !isLoading && rows.length === 0
            ? hiddenDeprecatedCount > 0
              ? `No test cases match these filters — ${hiddenDeprecatedCount} deprecated case${hiddenDeprecatedCount === 1 ? '' : 's'} hidden, check "Show deprecated".`
              : 'No test cases match these filters.'
            : undefined
        }
        selection={{
          selected,
          onToggle: toggleRow,
          onToggleAll: toggleAll,
          label: (r) => `Select ${r.case.title}`,
        }}
        onRowContextMenu={(e, { case: tc }) => {
          const nextAction = NEXT_ACTION[tc.status]
          const contextItems: RowContextMenuItem[] = [
            { label: 'Open', onSelect: () => navigate(`/test-cases/${tc.id}`) },
            ...(nextAction
              ? [{ label: nextAction.label, onSelect: () => advance(tc) }]
              : []),
            ...(tc.status === 'draft'
              ? [{ label: 'Delete', destructive: true, onSelect: () => confirmDelete(tc) }]
              : []),
          ]
          rowMenu.openAt(e, contextItems)
        }}
        rowActions={({ case: tc }) => {
          const nextAction = NEXT_ACTION[tc.status]
          return (
            <div className="flex justify-end gap-1.5">
              {nextAction && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={inlineActionMutation.isPending}
                  onClick={() => advance(tc)}
                >
                  {nextAction.label}
                </Button>
              )}
              {tc.status === 'draft' && (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={deleteMutation.isPending}
                  onClick={() => confirmDelete(tc)}
                >
                  Delete
                </Button>
              )}
            </div>
          )
        }}
      />
      {rowMenu.menu}
      {confirmDialog}

      {failedCount > 0 && (
        <div className="rounded-md border border-[var(--border)] bg-[var(--background)]">
          <ErrorState
            message={`${failedCount} of ${targetProjects.length} project${targetProjects.length === 1 ? '' : 's'} could not be loaded, so the list below is incomplete.`}
            onRetry={invalidateRepository}
          />
        </div>
      )}

      {rows.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 text-xs text-[var(--muted-foreground)]">
          <p>
            {rows.length} test case{rows.length === 1 ? '' : 's'} shown
            {hasMore ? ` of ${totalAvailable} matching` : ''} across {targetProjects.length} project
            {targetProjects.length === 1 ? '' : 's'}
            {selectedRows.length > 0 ? ` · ${selectedRows.length} selected` : ''}.
          </p>
          {hasMore && (
            <Button
              size="sm"
              variant="outline"
              disabled={loadingMore}
              onClick={() => void loadMore()}
              className="max-md:flex-1"
            >
              {loadingMore ? 'Loading…' : `Load more (${totalAvailable - allRows.length} remaining)`}
            </Button>
          )}
        </div>
      )}

      {/* GAP-91 item 1: a 10+ field form no longer fits well in a centered
          Dialog -- a full-height Drawer gives it real room. */}
      <Drawer open={createOpen} onClose={() => setCreateOpen(false)} title="New Test Case">
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="create-project" required>Project</Label>
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
