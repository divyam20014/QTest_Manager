import { ChevronRight } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { keepPreviousData, useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'

import { ApiError } from '@/api/client'
import { listProjects, type Project } from '@/api/projects'
import {
  approveTestCase,
  bulkUpdateTestCases,
  deleteTestCase,
  deprecateTestCase,
  listAllTestCases,
  listTestCases,
  submitForReview,
  type Priority,
  type TestCase,
  type TestCaseStatus,
} from '@/api/testCases'
import { listUsers } from '@/api/users'
import { QuarantinedBadge } from '@/components/ui/QuarantinedBadge'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { PageHeader } from '@/components/ui/PageHeader'
import { Button } from '@/components/ui/button'
import { useConfirm } from '@/components/ui/useConfirm'
import { Dialog } from '@/components/ui/dialog'
import { EmptyState, ErrorState } from '@/components/ui/empty-state'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { SegmentedToggle } from '@/components/ui/segmented'
import { type FilterChip } from '@/components/list/FilterChips'
import { hasPermission } from '@/api/auth'
import { useAuth } from '@/lib/auth'
import { ColumnVisibilityMenu } from '@/components/table/ColumnVisibilityMenu'
import { FilterTabs } from '@/components/ui/filter-tabs'
import { filterTabId } from '@/components/ui/filterTabId'
import { LevelBadge } from '@/components/ui/LevelBadge'
import { ListFilterField, ListToolbar } from '@/components/list/ListToolbar'
import { RowDetailDrawer, type RowDetailConfig } from '@/components/list/RowDetailDrawer'
import { rowDetailProps } from '@/components/list/rowDetail'
import { buildStatusTabs } from '@/components/list/statusTabs'
import {
  CARD_LINK_CLASS,
  ResponsiveTable,
  type ResponsiveColumn,
  type RowSelection,
} from '@/components/table/ResponsiveTable'
import { useRowContextMenu, type RowContextMenuItem } from '@/components/table/RowContextMenu'
import { SavedFiltersMenu } from '@/components/table/SavedFiltersMenu'
import { useColumnPrefs, useSavedFilters, type TableColumnDef } from '@/components/table/tablePrefs'
import { ExecutionStatusBadge } from '@/routes/testcases/ExecutionStatusBadge'
import { useToast } from '@/lib/toast'
import { useCanListUsers } from '@/lib/useCanListUsers'
import { useDebouncedValue } from '@/lib/useDebouncedValue'
import { cn } from '@/lib/utils'
import { STATUS_DISPLAY, priorityTone } from '@/routes/testcases/statusDisplay'
import { BulkMetadataDialog, type BulkMetadataKind } from './BulkMetadataDialog'
import { testCasePath } from '@/lib/entityRoutes'

const REPO_COLUMNS: TableColumnDef[] = [
  { key: 'title', label: 'Title', alwaysVisible: true, defaultWidth: 280 },
  { key: 'display_id', label: 'Test Case ID', defaultWidth: 120 },
  { key: 'project', label: 'Project', defaultWidth: 160 },
  { key: 'status', label: 'Review Status', alwaysVisible: true, defaultWidth: 140 },
  { key: 'execution', label: 'Execution Status', defaultWidth: 140 },
  { key: 'priority', label: 'Priority', defaultWidth: 110 },
  { key: 'assignee', label: 'Assignee', defaultWidth: 140 },
  { key: 'steps', label: 'Steps', defaultWidth: 80, defaultHidden: true },
]

// The API caps page_size at 100 and returns `total`. Each project loads 50 at a
// time and "Load more" fetches the next page for every project that still has
// cases it has not shown -- nothing is silently cut off.
const PAGE_SIZE = 50

const PRIORITIES: Priority[] = ['Low', 'Medium', 'High', 'Critical']
const STATUSES: TestCaseStatus[] = ['draft', 'ready_for_review', 'approved', 'deprecated']

const STATUS_TAB_LABELS = Object.fromEntries(STATUSES.map((s) => [s, STATUS_DISPLAY[s].label]))

type RepoRow = { project: Project; case: TestCase }

const REPO_DETAIL: RowDetailConfig<RepoRow> = {
  entity: 'test case',
  title: ({ case: tc }) => tc.title,
  badges: ({ case: tc }) => (
    <>
      <ExecutionStatusBadge status={tc.execution_status} />
      <StatusBadge tone={STATUS_DISPLAY[tc.status].tone}>Review: {tc.status_label}</StatusBadge>
      <LevelBadge tone={priorityTone(tc.priority)}>{tc.priority} priority</LevelBadge>
      {tc.quarantined && <QuarantinedBadge title={tc.quarantine_reason} />}
    </>
  ),
  fields: ({ case: tc, project }) => [
    { label: 'Test Case ID', value: <span className="font-mono text-xs">{tc.display_id ?? tc.id.slice(0, 8)}</span> },
    { label: 'Module', value: tc.module_path ?? 'Ungrouped' },
    { label: 'Project', value: project.name },
    { label: 'Version', value: `v${tc.version_number}` },
    { label: 'Steps', value: tc.steps.length },
    { label: 'Created', value: new Date(tc.created_at).toLocaleDateString() },
    { label: 'Execution status', value: tc.execution_status },
  ],
  description: ({ case: tc }) => tc.description,
  href: ({ case: tc }) => testCasePath(tc.project_id, tc.id),
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
// /test-cases endpoint exists on the backend, so each project's cases are
// fetched one request per project (server-side filtered by the same
// search/status/priority params TestCasesList already uses), newest first.
//
// UX-008: that fan-out used to run for every project on every load and
// render every row. Now:
//  - projects the list already says are empty (`test_case_count`, which is
//    exact) are never requested;
//  - with "All projects", each project is a collapsible group listed with its
//    case count, and only an open group is fetched and rendered -- the first
//    one starts open. While a search/status/priority filter is active every
//    group opens, because the filter has to be answered by each project (there
//    is no cross-project endpoint); groups with no match then disappear;
//  - the search box is debounced, so typing no longer sends a request per
//    keystroke per project;
//  - a single project (a project filter, or a tenant with one non-empty
//    project) is the same flat list as before.
// Bulk/inline actions call the same existing single-item endpoints
// TestCasesList already uses, one call per selected row (Promise.allSettled)
// -- no new bulk backend endpoint, fine at this tenant's realistic counts.
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
  // The status tabs drive this filter and keep `?status=` in the URL (the dashboard deep link).
  function changeStatus(key: string) {
    setStatus(key as TestCaseStatus | '')
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        if (key) next.set('status', key)
        else next.delete('status')
        return next
      },
      { replace: true },
    )
  }
  const [detailRow, setDetailRow] = useState<RepoRow | null>(null)
  const [priority, setPriority] = useState<Priority | ''>('')
  // BRD FR-TC-01: "Assigned to Me / View All". Kept in the URL as
  // `?assignee=me` (shareable, survives a refresh) and sent to the existing
  // `assignee_id` list filter -- the user id itself never goes in the URL.
  const { user } = useAuth()
  const [mine, setMineState] = useState(searchParams.get('assignee') === 'me')
  function setMine(next: boolean) {
    setMineState(next)
    setSearchParams(
      (prev) => {
        const params = new URLSearchParams(prev)
        if (next) params.set('assignee', 'me')
        else params.delete('assignee')
        return params
      },
      { replace: true },
    )
  }
  const assigneeFilter = mine && user ? user.user_id : ''
  const canCreate = hasPermission(user, 'testcase.create')
  // Bug #8: deprecated cases cluttered the list by default (every seeded
  // case here happened to be deprecated) -- hidden unless explicitly
  // toggled on, or unless the status filter itself is set to Deprecated.
  const [showDeprecated, setShowDeprecated] = useState(false)
  const [projectId, setProjectId] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [bulkMessage, setBulkMessage] = useState<string | null>(null)
  const [bulkPending, setBulkPending] = useState(false)
  // ADR-070: bulk priority / assignee dialog (metadata-only, never forks a version).
  const [bulkMetaKind, setBulkMetaKind] = useState<BulkMetadataKind | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [createProjectId, setCreateProjectId] = useState('')
  const { show: showToast } = useToast()
  const { ask, dialog: confirmDialog } = useConfirm()
  // Pages beyond the first, per project (see PAGE_SIZE).
  const [extra, setExtra] = useState<Record<string, { page: number; items: TestCase[] }>>({})
  const [loadingMore, setLoadingMore] = useState(false)
  // ADR-077: pages beyond the first of the single tenant-wide listing used while a
  // filter is on (see `unified` below).
  const [unifiedExtra, setUnifiedExtra] = useState<{ page: number; items: TestCase[] }>({
    page: 1,
    items: [],
  })
  // The box keeps the live value (typing stays instant); requests use this one.
  const debouncedSearch = useDebouncedValue(search, 300)
  // Open/closed groups the user chose themselves (see the header comment for
  // the defaults).
  const [toggled, setToggled] = useState<Record<string, boolean>>({})
  const filterSignature = JSON.stringify([debouncedSearch, status, priority, projectId, assigneeFilter])
  const filterSignatureRef = useRef(filterSignature)
  filterSignatureRef.current = filterSignature
  useEffect(() => {
    setExtra({})
    setUnifiedExtra({ page: 1, items: [] })
    // A new search/filter starts from the default open/closed state, so a group
    // the user collapsed earlier cannot hide the results of the new filter.
    setToggled({})
  }, [filterSignature])

  // Phase 2: the command palette's "Create Test Case" quick action
  // navigates here with ?action=create -- reuses this existing create
  // drawer rather than inventing a new creation flow.
  useEffect(() => {
    if (searchParams.get('action') === 'create') {
      startCreate(projectId)
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
    assignee: mine ? 'me' : '',
  }
  function applyFilters(f: Record<string, string>) {
    setSearch(f.search ?? '')
    setStatus((f.status as TestCaseStatus | '') ?? '')
    setPriority((f.priority as Priority | '') ?? '')
    setProjectId(f.projectId ?? '')
    setShowDeprecated(f.showDeprecated === 'true')
    setMine(f.assignee === 'me')
  }

  const projectsQuery = useQuery({
    queryKey: ['projects', 'all'],
    queryFn: () => listProjects({ page_size: 100 }),
  })
  const canListUsers = useCanListUsers()
  const usersQuery = useQuery({ queryKey: ['users'], queryFn: listUsers, enabled: canListUsers })

  const projects = projectsQuery.data?.items ?? []
  // A project the list reports as empty has nothing to fetch or show. (An
  // explicit project filter always keeps that project, so "No test cases
  // match" still appears for it.)
  const targetProjects = projectId
    ? projects.filter((p) => p.id === projectId)
    : projects.filter((p) => (p.test_case_count ?? 1) > 0)
  // A filter that has to be answered by every project opens every group.
  const filtersActive = Boolean(debouncedSearch || status || priority || assigneeFilter)
  // ADR-077: with a filter on and no project chosen, ONE tenant-wide request answers it
  // (it used to ask every non-empty project) and the results show as a flat list with a
  // Project column. Without a filter, projects stay as collapsible groups that load on open.
  const unified = !projectId && filtersActive && targetProjects.length > 1
  const grouped = targetProjects.length > 1 && !unified
  const firstProjectId = targetProjects[0]?.id
  function isOpen(id: string): boolean {
    if (!grouped) return true
    return toggled[id] ?? (filtersActive || id === firstProjectId)
  }

  const perProjectQueries = useQueries({
    queries: targetProjects.map((project) => ({
      queryKey: ['test-repository', project.id, { search: debouncedSearch, status, priority, assignee: assigneeFilter }],
      queryFn: () =>
        listTestCases(project.id, {
          search: debouncedSearch,
          status,
          priority,
          assignee_id: assigneeFilter,
          sort: '-created_at',
          page_size: PAGE_SIZE,
        }).then((r) => ({
          project,
          items: r.items,
          total: r.total,
        })),
      enabled: isOpen(project.id) && !unified,
    })),
  })

  const unifiedQuery = useQuery({
    queryKey: [
      'test-repository',
      'all',
      { search: debouncedSearch, status, priority, assignee: assigneeFilter },
    ],
    queryFn: () =>
      listAllTestCases({
        search: debouncedSearch,
        status,
        priority,
        assignee_id: assigneeFilter,
        sort: '-created_at',
        page_size: PAGE_SIZE,
      }),
    enabled: unified,
  })

  // Status tab counts: one tiny request per tab (page_size 1 -> only `total` is read), under every
  // other filter. A single project uses its own listing, otherwise the tenant-wide one (ADR-077).
  const countKeys: (TestCaseStatus | '')[] = ['', ...STATUSES]
  const countQueries = useQueries({
    queries: countKeys.map((key) => ({
      queryKey: [
        'test-repository',
        'counts',
        { key, projectId, search: debouncedSearch, priority, assignee: assigneeFilter },
      ],
      queryFn: () => {
        const params = { search: debouncedSearch, status: key, priority, assignee_id: assigneeFilter, page_size: 1 }
        return (projectId ? listTestCases(projectId, params) : listAllTestCases(params)).then((r) => r.total)
      },
      placeholderData: keepPreviousData,
    })),
  })
  const countsReady = countQueries.every((q) => q.data !== undefined)
  const countByStatus = Object.fromEntries(STATUSES.map((s, i) => [s, countQueries[i + 1].data ?? 0]))
  const statusTabs = buildStatusTabs({
    order: STATUSES,
    counts: countByStatus,
    // Deprecated cases are hidden unless asked for, so "All" matches what the list can show.
    total: (countQueries[0].data ?? 0) - (showDeprecated ? 0 : (countByStatus.deprecated ?? 0)),
    ready: countsReady,
    labels: STATUS_TAB_LABELS,
  })

  const usersById = useMemo(
    () => new Map((usersQuery.data ?? []).map((u) => [u.id, u.name])),
    [usersQuery.data],
  )

  type Row = RepoRow
  interface RepoGroup {
    project: Project
    open: boolean
    loading: boolean
    failed: boolean
    /** Loaded cases (first page + "Load more" pages), de-duplicated, newest first. */
    loaded: TestCase[]
    /** Server-side matching total once loaded. */
    total: number | undefined
    /** Rows on screen (deprecated ones hidden unless asked for). */
    rows: Row[]
    hiddenDeprecated: number
  }
  const projectsById = new Map(projects.map((p) => [p.id, p]))
  const unifiedGroups: RepoGroup[] = []
  if (unified && targetProjects[0]) {
    const seen = new Set<string>()
    const loaded = unifiedQuery.data
      ? [...unifiedQuery.data.items, ...unifiedExtra.items]
          .filter((c) => (seen.has(c.id) ? false : (seen.add(c.id), true)))
          .sort((a, b) => b.created_at.localeCompare(a.created_at))
      : []
    const shown = loaded.filter(
      (c) => showDeprecated || status === 'deprecated' || c.status !== 'deprecated',
    )
    unifiedGroups.push({
      // Only a placeholder: every row below carries its own real project.
      project: targetProjects[0],
      open: true,
      loading: unifiedQuery.isLoading,
      failed: unifiedQuery.isError,
      loaded,
      total: unifiedQuery.data?.total,
      rows: shown.map((c) => ({
        project: projectsById.get(c.project_id) ?? targetProjects[0],
        case: c,
      })),
      hiddenDeprecated: loaded.length - shown.length,
    })
  }
  const perProjectGroups: RepoGroup[] = unified ? [] : targetProjects.map((project, i) => {
    const q = perProjectQueries[i]
    const open = isOpen(project.id)
    const seen = new Set<string>()
    const loaded = q?.data
      ? [...q.data.items, ...(extra[project.id]?.items ?? [])]
          .filter((c) => (seen.has(c.id) ? false : (seen.add(c.id), true)))
          .sort((a, b) => b.created_at.localeCompare(a.created_at))
      : []
    const shown = loaded.filter(
      (c) => showDeprecated || status === 'deprecated' || c.status !== 'deprecated',
    )
    return {
      project,
      open,
      loading: open && !!q?.isLoading,
      failed: open && !!q?.isError,
      loaded,
      total: q?.data?.total,
      rows: open ? shown.map((c) => ({ project, case: c })) : [],
      hiddenDeprecated: open ? loaded.length - shown.length : 0,
    }
  })
  const groups: RepoGroup[] = unified ? unifiedGroups : perProjectGroups
  // With a filter on, a project that answered "no matches" is not worth a header.
  const visibleGroups = groups.filter((g) => !(filtersActive && g.total === 0 && !g.failed))
  const openGroups = visibleGroups.filter((g) => g.open)

  const isLoading = projectsQuery.isLoading || openGroups.some((g) => g.loading)
  const failedCount = openGroups.filter((g) => g.failed).length
  // Everything on screen -- the rows bulk actions and Select all work on.
  const rows: Row[] = openGroups.flatMap((g) => g.rows)
  const hiddenDeprecatedCount = openGroups.reduce((n, g) => n + g.hiddenDeprecated, 0)
  // How much of what the server holds, in the open groups, is on screen.
  const totalAvailable = openGroups.reduce((sum, g) => sum + (g.total ?? 0), 0)
  const remaining = openGroups.reduce(
    (sum, g) => sum + (g.total === undefined ? 0 : Math.max(0, g.total - g.loaded.length)),
    0,
  )
  const hasMore = remaining > 0

  async function loadMore() {
    const signature = filterSignatureRef.current
    if (unified) {
      setLoadingMore(true)
      const page = unifiedExtra.page + 1
      try {
        const r = await listAllTestCases({
          search: debouncedSearch,
          status,
          priority,
          assignee_id: assigneeFilter,
          sort: '-created_at',
          page_size: PAGE_SIZE,
          page,
        })
        // The filters changed while this was loading: those rows belong to a different result set.
        if (signature === filterSignatureRef.current) {
          setUnifiedExtra((prev) => ({ page, items: [...prev.items, ...r.items] }))
        }
      } catch {
        showToast('error', 'Some test cases could not be loaded. Try “Load more” again.')
      } finally {
        setLoadingMore(false)
      }
      return
    }
    setLoadingMore(true)
    const targets = openGroups.filter((g) => g.total !== undefined && g.loaded.length < g.total)
    const results = await Promise.allSettled(
      targets.map(async (g) => {
        const page = (extra[g.project.id]?.page ?? 1) + 1
        const r = await listTestCases(g.project.id, {
          search: debouncedSearch,
          status,
          priority,
          assignee_id: assigneeFilter,
          sort: '-created_at',
          page_size: PAGE_SIZE,
          page,
        })
        return { id: g.project.id, page, items: r.items }
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

  function toggleGroup(id: string) {
    const willOpen = !isOpen(id)
    setToggled((prev) => ({ ...prev, [id]: willOpen }))
    if (!willOpen) {
      // Rows that are no longer on screen must not stay selected: bulk actions
      // only ever act on what the user can see.
      const hidden = new Set((groups.find((g) => g.project.id === id)?.loaded ?? []).map((c) => c.id))
      setSelected((prev) => new Set([...prev].filter((cid) => !hidden.has(cid))))
    }
  }

  function invalidateRepository() {
    // Back to the first page: rows loaded by "Load more" may have been deleted
    // or changed, and the refetch only covers the first page of each project.
    setExtra({})
    setUnifiedExtra({ page: 1, items: [] })
    queryClient.invalidateQueries({ predicate: (q) => q.queryKey[0] === 'test-repository' })
    // The per-project counts decide which projects are requested at all.
    queryClient.invalidateQueries({ queryKey: ['projects', 'all'] })
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

  // Select all works on one group's on-screen rows (the whole list when there is
  // a single group), so a header checkbox never selects rows it cannot see.
  function selectionFor(groupRows: Row[]): RowSelection<Row> {
    const ids = new Set(groupRows.map((r) => r.case.id))
    return {
      selected: new Set([...selected].filter((id) => ids.has(id))),
      onToggle: toggleRow,
      onToggleAll: () =>
        setSelected((prev) => {
          const next = new Set(prev)
          const allIn = groupRows.length > 0 && groupRows.every((r) => prev.has(r.case.id))
          for (const id of ids) {
            if (allIn) next.delete(id)
            else next.add(id)
          }
          return next
        }),
      label: (r) => `Select ${r.case.title}`,
    }
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

  // The create form is a full page per project. With a project chosen (or only one to choose from) go
  // straight there; otherwise ask which project first.
  function startCreate(preferred: string) {
    const target = preferred || (projects.length === 1 ? projects[0].id : '')
    if (target) navigate(`/projects/${target}/test-cases/new`)
    else {
      setCreateProjectId('')
      setCreateOpen(true)
    }
  }

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

  async function runBulkMetadata(value: string | null) {
    const kind = bulkMetaKind
    const ids = rows.filter((r) => selected.has(r.case.id)).map((r) => r.case.id)
    if (!kind || ids.length === 0) return
    setBulkPending(true)
    setBulkMessage(null)
    try {
      const result = await bulkUpdateTestCases(
        kind === 'priority'
          ? { test_case_ids: ids, priority: value ?? undefined }
          : { test_case_ids: ids, assignee_id: value },
      )
      const firstError = result.results.find((r) => !r.ok)?.error
      setBulkMessage(
        result.failed === 0
          ? `${result.updated} test case${result.updated === 1 ? '' : 's'} updated.`
          : `${result.updated} updated, ${result.failed} failed${firstError ? ` (${firstError})` : ''}.`,
      )
      setBulkMetaKind(null)
      setSelected(new Set())
      invalidateRepository()
    } catch (err) {
      showToast('error', err instanceof ApiError ? err.message : 'Could not update the selected test cases.')
    } finally {
      setBulkPending(false)
    }
  }

  const selectedRows = rows.filter((r) => selected.has(r.case.id))

  // One definition feeds the desktop table and the phone cards (ResponsiveTable).
  const tableColumns: ResponsiveColumn<Row>[] = [
    {
      key: 'title',
      header: 'Title',
      limitWidth: true,
      card: 'title',
      cell: ({ case: tc }) => (
        <Link to={testCasePath(tc.project_id, tc.id)} className="block truncate font-medium underline-offset-2 hover:underline">
          {tc.title}
        </Link>
      ),
      cardCell: ({ case: tc }) => (
        <Link to={testCasePath(tc.project_id, tc.id)} className={CARD_LINK_CLASS}>
          {tc.title}
        </Link>
      ),
    },
    {
      key: 'display_id',
      header: 'Test Case ID',
      card: 'meta',
      cell: ({ case: tc }) => (
        <Link to={testCasePath(tc.project_id, tc.id)} className="font-mono text-xs underline-offset-2 hover:underline">
          {tc.display_id ?? tc.id.slice(0, 8)}
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
      key: 'execution',
      header: 'Execution Status',
      card: 'badge',
      cell: ({ case: tc }) => <ExecutionStatusBadge status={tc.execution_status} />,
    },
    {
      key: 'status',
      header: 'Review Status',
      card: 'badge',
      cell: ({ case: tc }) => (
        <span className="inline-flex flex-wrap items-center gap-1">
          <StatusBadge tone={STATUS_DISPLAY[tc.status].tone}>{tc.status_label}</StatusBadge>
          {tc.quarantined && <QuarantinedBadge title={tc.quarantine_reason} />}
        </span>
      ),
    },
    {
      key: 'priority',
      header: 'Priority',
      card: 'badge',
      cell: ({ case: tc }) => <LevelBadge tone={priorityTone(tc.priority)}>{tc.priority}</LevelBadge>,
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

  // One definition feeds every table: the flat list, and each open project group.
  function clearRepoFilters() {
    setPriority('')
    setProjectId('')
    setShowDeprecated(false)
    setMine(false)
  }

  const filterChips: FilterChip[] = [
    ...(projectId
      ? [{ key: 'project', label: 'Project', value: projects.find((p) => p.id === projectId)?.name ?? projectId }]
      : []),
    ...(priority ? [{ key: 'priority', label: 'Priority', value: priority }] : []),
    ...(mine ? [{ key: 'mine', label: 'Assignee', value: 'Me' }] : []),
    ...(showDeprecated ? [{ key: 'deprecated', label: 'Deprecated', value: 'Shown' }] : []),
  ]
  function removeChip(key: string) {
    if (key === 'project') setProjectId('')
    else if (key === 'priority') setPriority('')
    else if (key === 'mine') setMine(false)
    else if (key === 'deprecated') setShowDeprecated(false)
  }

  function renderTable(
    groupRows: Row[],
    { label, loading, hiddenDeprecated }: { label: string; loading: boolean; hiddenDeprecated: number },
  ) {
    return (
      <ResponsiveTable
        label={label}
        className="bg-[var(--background)]"
        rows={groupRows}
        rowKey={(r) => r.case.id}
        // The group header already names the project, so the column would only repeat it.
        columns={grouped ? tableColumns.filter((c) => c.key !== 'project') : tableColumns}
        prefs={columnPrefs}
        rowProps={(r) => rowDetailProps(() => setDetailRow(r))}
        loading={loading}
        stateCellClassName="px-4"
        state={
          !loading && groupRows.length === 0 ? (
            hiddenDeprecated > 0 || status || priority || projectId || mine || debouncedSearch ? (
              <EmptyState
                variant="filtered"
                title="No test cases match these filters"
                description={
                  hiddenDeprecated > 0
                    ? `${hiddenDeprecated} deprecated case${hiddenDeprecated === 1 ? ' is' : 's are'} hidden. Tick "Show deprecated" to see ${hiddenDeprecated === 1 ? 'it' : 'them'}.`
                    : 'Try clearing a filter to see more results.'
                }
                action={
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      clearRepoFilters()
                      changeStatus('')
                      setSearch('')
                    }}
                  >
                    Clear filters
                  </Button>
                }
              />
            ) : (
              <EmptyState
                title="No test cases yet"
                description="Test cases from every project you can see are listed here. Create them from a project's Test Cases tab."
              />
            )
          ) : undefined
        }
        selection={selectionFor(groupRows)}
        onRowContextMenu={(e, { case: tc }) => {
          const nextAction = NEXT_ACTION[tc.status]
          const contextItems: RowContextMenuItem[] = [
            { label: 'Open', onSelect: () => navigate(testCasePath(tc.project_id, tc.id)) },
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
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Bug #11: previously defaulted to projects[0] when viewing "All
          projects" -- silently created the case in whichever project
          happened to sort first. Now defaults to unselected (forcing an
          explicit choice) unless the list is already filtered to one
          specific project. */}
      <PageHeader
        title="Test Cases"
        description="Every test case across your projects."
        actions={
          <Button onClick={() => startCreate(projectId)} disabled={projects.length === 0 || !canCreate} title={canCreate ? undefined : 'You need the Create test case permission'}>
            New Test Case
          </Button>
        }
      />

      <FilterTabs
        label="Review status"
        items={statusTabs}
        value={status}
        onChange={changeStatus}
        panelId="repo-panel"
      />

      <ListToolbar
        search={{
          id: 'repo-search',
          value: search,
          onChange: setSearch,
          placeholder: 'Search by title across all projects…',
        }}
        activeCount={filterChips.length}
        onClearFilters={clearRepoFilters}
        chips={filterChips}
        onRemoveChip={removeChip}
        saved={
          <SavedFiltersMenu
            current={currentFilters}
            saved={savedFilters.saved}
            onSave={savedFilters.save}
            onApply={applyFilters}
            onRemove={savedFilters.remove}
          />
        }
        columns={
          <ColumnVisibilityMenu
            columns={REPO_COLUMNS}
            isVisible={columnPrefs.isVisible}
            toggleVisible={columnPrefs.toggleVisible}
            showAll={columnPrefs.showAll}
            density={columnPrefs.density}
            setDensity={columnPrefs.setDensity}
          />
        }
        quick={
          <SegmentedToggle
            label="Whose test cases to show"
            value={mine ? 'mine' : 'all'}
            onChange={(v) => setMine(v === 'mine')}
            options={[
              { value: 'all', label: 'All cases' },
              { value: 'mine', label: 'Assigned to me' },
            ]}
          />
        }
        filters={
          <>
            <ListFilterField label="Project">
              <Select
                id="repo-project"
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
            <ListFilterField label="Priority">
              <Select
                id="repo-priority"
                aria-label="Priority"
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
            </ListFilterField>
            <label className="flex items-center gap-2 text-sm max-md:min-h-11">
              <input
                type="checkbox"
                checked={showDeprecated}
                onChange={(e) => setShowDeprecated(e.target.checked)}
              />
              Show deprecated
            </label>
          </>
        }
      />

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
          <Button size="sm" variant="outline" disabled={bulkPending} onClick={() => setBulkMetaKind('priority')}>
            Set priority
          </Button>
          {canListUsers && (
            <Button size="sm" variant="outline" disabled={bulkPending} onClick={() => setBulkMetaKind('assignee')}>
              Set assignee
            </Button>
          )}
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

      <div
        id="repo-panel"
        role="tabpanel"
        aria-labelledby={filterTabId('repo-panel', status)}
        className="flex flex-col gap-4"
      >
      {!grouped || visibleGroups.length === 0 ? (
        renderTable(rows, { label: 'Test cases', loading: isLoading, hiddenDeprecated: hiddenDeprecatedCount })
      ) : (
        <div className="flex flex-col gap-3">
          {visibleGroups.map((g) => {
            const id = g.project.id
            const count =
              g.total !== undefined && filtersActive
                ? `${g.total} matching`
                : `${g.project.test_case_count} test case${g.project.test_case_count === 1 ? '' : 's'}`
            return (
              <section key={id} className="flex flex-col gap-2">
                <h2 className="text-sm">
                  <button
                    type="button"
                    aria-expanded={g.open}
                    aria-controls={`repo-group-${id}`}
                    onClick={() => toggleGroup(id)}
                    className="flex min-h-11 w-full items-center gap-2 rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-left font-medium hover:bg-[var(--muted)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--ring)]"
                  >
                    <ChevronRight
                      aria-hidden="true"
                      className={cn('size-4 shrink-0 transition-transform motion-reduce:transition-none', g.open && 'rotate-90')}
                    />
                    <span className="min-w-0 flex-1 truncate">{g.project.name}</span>
                    <span className="shrink-0 text-xs font-normal text-[var(--muted-foreground)]">{count}</span>
                  </button>
                </h2>
                {g.open && (
                  <div id={`repo-group-${id}`}>
                    {renderTable(g.rows, {
                      label: `Test cases in ${g.project.name}`,
                      loading: g.loading,
                      hiddenDeprecated: g.hiddenDeprecated,
                    })}
                  </div>
                )}
              </section>
            )
          })}
        </div>
      )}
      </div>
      {rowMenu.menu}
      <RowDetailDrawer row={detailRow} onClose={() => setDetailRow(null)} config={REPO_DETAIL} />
      {confirmDialog}
      <BulkMetadataDialog
        kind={bulkMetaKind}
        count={selected.size}
        users={usersQuery.data ?? []}
        pending={bulkPending}
        onClose={() => setBulkMetaKind(null)}
        onSubmit={(value) => void runBulkMetadata(value)}
      />

      {failedCount > 0 && (
        <div className="rounded-md border border-[var(--border)] bg-[var(--background)]">
          <ErrorState
            message={
              unified
                ? 'The matching test cases could not be loaded.'
                : `${failedCount} of ${openGroups.length} project${openGroups.length === 1 ? '' : 's'} could not be loaded, so the list below is incomplete.`
            }
            onRetry={invalidateRepository}
          />
        </div>
      )}

      {rows.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 text-xs text-[var(--muted-foreground)]">
          <p aria-live="polite">
            {grouped
              ? `${rows.length} test case${rows.length === 1 ? '' : 's'} shown from ${openGroups.length} of ${visibleGroups.length} projects${hasMore ? ` · ${remaining} more in the open projects` : ''}`
              : unified
                ? `Showing 1-${rows.length} of ${Math.max(totalAvailable, rows.length)} matching across all projects`
                : `Showing 1-${rows.length} of ${Math.max(totalAvailable, rows.length)} across ${targetProjects.length} project${targetProjects.length === 1 ? '' : 's'}`}
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
              {loadingMore ? 'Loading…' : `Load more (${remaining} remaining)`}
            </Button>
          )}
        </div>
      )}

      <Dialog open={createOpen} onClose={() => setCreateOpen(false)} title="New Test Case">
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault()
            if (createProjectId) navigate(`/projects/${createProjectId}/test-cases/new`)
          }}
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="create-project" required>
              Project
            </Label>
            <Select id="create-project" required value={createProjectId} onChange={(e) => setCreateProjectId(e.target.value)}>
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
          <p className="text-sm text-[var(--muted-foreground)]">The test case form opens for that project.</p>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!createProjectId}>
              Continue
            </Button>
          </div>
        </form>
      </Dialog>
    </div>
  )
}
