import { useMemo, useState } from 'react'
import { keepPreviousData, useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { Link, useParams, useSearchParams } from 'react-router-dom'

import { ApiError, downloadFile } from '@/api/client'
import { exportUrl, exportXlsxPath } from '@/api/csvImport'
import { createModule, deleteModule, listModules } from '@/api/modules'
import { listSharedSteps } from '@/api/sharedSteps'
import { getProject } from '@/api/projects'
import {
  assignModule,
  createTestCase,
  listTestCases,
  type Priority,
  type TestCase,
  type TestCaseCreateRequest,
  type TestCaseStatus,
} from '@/api/testCases'
import { listUsers } from '@/api/users'
import { listFieldOptions } from '@/api/fieldCustomization'
import { MoreActionsMenu } from '@/components/list/MoreActionsMenu'
import { ListFilterField, ListToolbar } from '@/components/list/ListToolbar'
import { RowDetailDrawer, type RowDetailConfig } from '@/components/list/RowDetailDrawer'
import { rowDetailProps } from '@/components/list/rowDetail'
import { buildStatusTabs } from '@/components/list/statusTabs'
import { FilterTabs } from '@/components/ui/filter-tabs'
import { filterTabId } from '@/components/ui/filterTabId'
import { LevelBadge } from '@/components/ui/LevelBadge'
import { Pagination } from '@/components/ui/pagination'
import { ViewsMenu } from '@/components/table/ViewsMenu'
import { ColumnVisibilityMenu } from '@/components/table/ColumnVisibilityMenu'
import { useColumnPrefs, type TableColumnDef } from '@/components/table/tablePrefs'
import { hasPermission } from '@/api/auth'
import { MAX_BULK_SELECTION } from '@/lib/bulkActions'
import { TestCaseBulkBar, type BulkSelectedCase } from './TestCaseBulkBar'
import { compactFilters, useApplyDefaultView, type ViewState } from '@/components/table/viewsHelpers'
import { CARD_LINK_CLASS, ResponsiveTable, type ResponsiveColumn } from '@/components/table/ResponsiveTable'
import { QuarantinedBadge } from '@/components/ui/QuarantinedBadge'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { PageHeader } from '@/components/ui/PageHeader'
import { EmptyState, ErrorState } from '@/components/ui/empty-state'
import { Button } from '@/components/ui/button'
import { useConfirm } from '@/components/ui/useConfirm'
import { Dialog, Drawer } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { useToast } from '@/lib/toast'
import { useIsMobile } from '@/lib/useMediaQuery'
import { useUrlFilters } from '@/lib/useUrlFilters'
import { useAuth } from '@/lib/auth'
import { SegmentedToggle } from '@/components/ui/segmented'
import { type FilterChip } from '@/components/list/FilterChips'
import { useCanListUsers } from '@/lib/useCanListUsers'
import { ImportDialog } from './ImportDialog'
import { SharedStepsDialog } from './SharedStepsDialog'
import { TemplatesDialog } from './TemplatesDialog'
import { draftToFormValues, type QuickDraft } from '@/lib/quickCase'
import { QuickCreateTestCaseDialog } from './QuickCreateTestCaseDialog'
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

// ADR-105: column customization; title and status are always shown.
const TC_COLUMNS: TableColumnDef[] = [
  { key: 'title', label: 'Title', alwaysVisible: true },
  { key: 'status', label: 'Status', alwaysVisible: true },
  { key: 'priority', label: 'Priority' },
  { key: 'assignee', label: 'Assignee' },
  { key: 'module', label: 'Module' },
  { key: 'version', label: 'Version', defaultHidden: true },
  { key: 'steps', label: 'Steps', defaultHidden: true },
]

// ADR-096: the URL filters a saved view can hold, and the all-cleared state applying one starts from.
const TC_VIEW_KEYS = ['search', 'priority', 'status', 'assigneeId', 'moduleId', 'quarantined'] as const
const TC_VIEW_RESET = Object.fromEntries(TC_VIEW_KEYS.map((k) => [k, ''])) as Record<string, string>

export function TestCasesList() {
  const { projectId } = useParams<{ projectId: string }>()
  const [createOpen, setCreateOpen] = useState(false)
  // ADR-106: quick-create dialog; the dashboard's 'New test case' opens it via ?quick=1.
  const [searchParams, setSearchParams] = useSearchParams()
  const [quickOpen, setQuickOpen] = useState(searchParams.get('quick') === '1')
  const [formDefaults, setFormDefaults] = useState<TestCaseFormValues>(DEFAULT_VALUES)
  const [importOpen, setImportOpen] = useState(false)
  const [templatesOpen, setTemplatesOpen] = useState(false)
  const [sharedStepsOpen, setSharedStepsOpen] = useState(false)
  const [modulesOpen, setModulesOpen] = useState(false)
  const [detailRow, setDetailRow] = useState<TestCase | null>(null)
  const [newModuleName, setNewModuleName] = useState('')
  const queryClient = useQueryClient()
  const { show: showToast } = useToast()
  const { ask, dialog: confirmDialog } = useConfirm()
  const { user } = useAuth()
  const columnPrefs = useColumnPrefs('test-cases-list', TC_COLUMNS)

  // Bug #13: filters now persist in the URL (shareable, survives
  // refresh) instead of plain component state.
  const filterDefaults = useMemo(
    () => ({
      search: '',
      priority: '',
      status: '',
      assigneeId: '',
      moduleId: '',
      quarantined: '',
      sort: 'created_at',
      page: '1',
    }),
    [],
  )
  const urlFilters = useUrlFilters(filterDefaults)
  const applyView = (view: ViewState) =>
    urlFilters.setFilters({ ...TC_VIEW_RESET, ...view.filters, sort: view.sort ?? 'created_at', page: '1' })
  useApplyDefaultView('test_cases', urlFilters.active.length > 0, applyView)
  const search = urlFilters.values.search
  const priority = urlFilters.values.priority as Priority | ''
  const status = urlFilters.values.status as TestCaseStatus | ''
  const assigneeId = urlFilters.values.assigneeId
  const moduleId = urlFilters.values.moduleId
  const quarantined = urlFilters.values.quarantined as '' | 'only' | 'exclude'
  const sort = urlFilters.values.sort
  const page = Number(urlFilters.values.page) || 1
  // Bug #8: deprecated cases cluttered the list by default -- hidden on
  // this page's items unless toggled on or explicitly filtered to
  // Deprecated. Filtered client-side (not an extra server param) since
  // the list endpoint only supports "equals one status", not "exclude
  // one status" -- a page can show fewer than PAGE_SIZE rows as a result,
  // which is an acceptable trade-off for this fix.
  const [showDeprecated, setShowDeprecated] = useState(false)
  const isMobile = useIsMobile()

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
  const canListUsers = useCanListUsers()
  const usersQuery = useQuery({ queryKey: ['users'], queryFn: listUsers, enabled: canListUsers })
  const modulesQuery = useQuery({
    queryKey: ['test-modules', projectId],
    queryFn: () => listModules(projectId!),
    enabled: !!projectId,
  })
  const sharedStepsQuery = useQuery({
    queryKey: ['shared-steps', projectId],
    queryFn: () => listSharedSteps(projectId!),
    enabled: !!projectId,
  })
  const testCasesQuery = useQuery({
    queryKey: ['test-cases', projectId, { search, priority, status, assigneeId, moduleId, quarantined, sort, page }],
    queryFn: () =>
      listTestCases(projectId!, {
        search,
        priority,
        status,
        assignee_id: assigneeId,
        module_id: moduleId || undefined,
        quarantined: quarantined || undefined,
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
      showToast('success', 'Module deleted')
    },
    onError: (err) =>
      showToast('error', err instanceof ApiError ? err.message : 'Could not delete that module'),
  })

  const createError = createMutation.error instanceof ApiError ? createMutation.error.message : null
  const usersById = new Map((usersQuery.data ?? []).map((u) => [u.id, u.name]))
  const modules = modulesQuery.data ?? []

  const total = testCasesQuery.data?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  function setFilter(key: 'search' | 'priority' | 'status' | 'assigneeId' | 'moduleId' | 'quarantined', value: string) {
    urlFilters.setFilters({ [key]: value, page: '1' })
  }

  function toggleSort(key: string) {
    const currentKey = sort.replace(/^-/, '')
    const next = currentKey !== key ? key : sort.startsWith('-') ? key : `-${key}`
    urlFilters.setFilters({ sort: next, page: '1' })
  }

  function setPage(next: number) {
    urlFilters.setFilter('page', String(Math.max(1, next)))
  }

  const filterChips: FilterChip[] = [
    ...(priority ? [{ key: 'priority', label: 'Priority', value: priority }] : []),
    ...(assigneeId
      ? [
          {
            key: 'assigneeId',
            label: 'Assignee',
            value:
              assigneeId === user?.user_id
                ? 'Me'
                : (usersQuery.data?.find((u) => u.id === assigneeId)?.name ?? assigneeId),
          },
        ]
      : []),
    ...(moduleId ? [{ key: 'moduleId', label: 'Module', value: modules.find((m) => m.id === moduleId)?.name ?? moduleId }] : []),
    ...(quarantined
      ? [{ key: 'quarantined', label: 'Quarantine', value: quarantined === 'only' ? 'Only quarantined' : 'Hide quarantined' }]
      : []),
    ...(showDeprecated ? [{ key: 'deprecated', label: 'Deprecated', value: 'Shown' }] : []),
  ]
  function removeChip(key: string) {
    if (key === 'deprecated') setShowDeprecated(false)
    else setFilter(key as 'priority' | 'assigneeId' | 'moduleId' | 'quarantined', '')
  }
  // Clears the filters in the panel; the search box and the status tab have their own controls.
  function clearPanelFilters() {
    urlFilters.setFilters({ priority: '', assigneeId: '', moduleId: '', quarantined: '', page: '1' })
    setShowDeprecated(false)
  }
  async function exportExcel() {
    try {
      await downloadFile(exportXlsxPath(projectId!), 'test_cases_export.xlsx')
      showToast('success', 'Export downloaded')
    } catch (error) {
      showToast(
        'error',
        error instanceof ApiError && error.status === 403
          ? 'You do not have permission to export this.'
          : 'Could not create the export. Please try again.',
      )
    }
  }

  // Status tab counts: one one-row request per tab (only `total` is read) under the other filters.
  const countKeys: (TestCaseStatus | '')[] = ['', ...STATUSES]
  const countQueries = useQueries({
    queries: countKeys.map((key) => ({
      queryKey: ['test-cases', projectId, 'status-count', { key, search, priority, assigneeId, moduleId, quarantined }],
      queryFn: () =>
        listTestCases(projectId!, {
          search,
          priority,
          status: key,
          assignee_id: assigneeId,
          module_id: moduleId || undefined,
          quarantined: quarantined || undefined,
          page_size: 1,
        }).then((r) => r.total),
      enabled: !!projectId,
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
    labels: Object.fromEntries(STATUSES.map((s) => [s, STATUS_DISPLAY[s].label])),
  })
  const detailConfig: RowDetailConfig<TestCase> = {
    entity: 'test case',
    title: (tc) => tc.title,
    badges: (tc) => (
      <>
        <StatusBadge tone={STATUS_DISPLAY[tc.status].tone}>{tc.status_label}</StatusBadge>
        <LevelBadge tone={priorityTone(tc.priority)}>{tc.priority} priority</LevelBadge>
        {tc.quarantined && <QuarantinedBadge title={tc.quarantine_reason} />}
      </>
    ),
    fields: (tc) => [
      { label: 'ID', value: <span className="font-mono text-xs">{tc.id.slice(0, 8)}</span> },
      { label: 'Project', value: projectQuery.data?.name ?? '—' },
      { label: 'Assignee', value: tc.assignee_id ? (usersById.get(tc.assignee_id) ?? 'Unknown') : 'Unassigned' },
      { label: 'Module', value: modules.find((m) => m.id === tc.module_id)?.name ?? 'Ungrouped' },
      { label: 'Version', value: `v${tc.version_number}` },
      { label: 'Steps', value: tc.steps.length },
      { label: 'Created', value: new Date(tc.created_at).toLocaleDateString() },
    ],
    description: (tc) => tc.description,
    href: (tc) => `/test-cases/${tc.id}`,
  }

  const allItems = testCasesQuery.data?.items ?? []
  const visibleItems = allItems.filter(
    (tc) => showDeprecated || status === 'deprecated' || tc.status !== 'deprecated',
  )
  const hiddenCount = allItems.length - visibleItems.length

  // ADR-105 bulk selection: kept across pages while the filters are unchanged,
  // cleared when they change (the key below), capped at MAX_BULK_SELECTION.
  const selectionKey = JSON.stringify([projectId, search, priority, status, assigneeId, moduleId, quarantined, showDeprecated])
  const [selection, setSelection] = useState<{ key: string; items: Map<string, BulkSelectedCase> }>({
    key: selectionKey,
    items: new Map(),
  })
  const selectedCases = selection.key === selectionKey ? selection.items : new Map<string, BulkSelectedCase>()
  function updateSelection(change: (next: Map<string, BulkSelectedCase>) => void) {
    const next = new Map(selectedCases)
    change(next)
    setSelection({ key: selectionKey, items: next })
  }
  function addCapped(next: Map<string, BulkSelectedCase>, tc: TestCase) {
    if (next.size >= MAX_BULK_SELECTION) return false
    next.set(tc.id, { title: tc.title, quarantined: tc.quarantined })
    return true
  }
  const bulkSelection = {
    selected: new Set(selectedCases.keys()),
    label: (tc: TestCase) => `Select ${tc.title}`,
    onToggle: (id: string) => {
      const tc = visibleItems.find((t) => t.id === id)
      if (!tc) return
      updateSelection((next) => {
        if (next.has(id)) next.delete(id)
        else if (!addCapped(next, tc)) showToast('error', `You can select at most ${MAX_BULK_SELECTION} test cases`)
      })
    },
    onToggleAll: () => {
      const allOnPage = visibleItems.length > 0 && visibleItems.every((tc) => selectedCases.has(tc.id))
      updateSelection((next) => {
        if (allOnPage) visibleItems.forEach((tc) => next.delete(tc.id))
        else if (!visibleItems.every((tc) => next.has(tc.id) || addCapped(next, tc)))
          showToast('error', `You can select at most ${MAX_BULK_SELECTION} test cases`)
      })
    },
  }
  const canBulkEdit = hasPermission(user, 'testcase.edit')
  const canBulkQuarantine = hasPermission(user, 'testcase.approve')
  const bulkEnabled = canBulkEdit || canBulkQuarantine

  const sortHeader = (key: string, label: string) => {
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

  const columns: ResponsiveColumn<TestCase>[] = [
    {
      key: 'title',
      header: 'Title',
      headerCell: sortHeader('title', 'Title'),
      card: 'title',
      cell: (tc) => (
        <Link to={`/test-cases/${tc.id}`} className="font-medium underline-offset-2 hover:underline">
          {tc.title}
        </Link>
      ),
      cardCell: (tc) => (
        <Link to={`/test-cases/${tc.id}`} className={CARD_LINK_CLASS}>
          {tc.title}
        </Link>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      headerCell: sortHeader('status', 'Status'),
      card: 'badge',
      cell: (tc) => (
        <span className="inline-flex flex-wrap items-center gap-1">
          <StatusBadge tone={STATUS_DISPLAY[tc.status].tone}>{tc.status_label}</StatusBadge>
          {tc.quarantined && <QuarantinedBadge title={tc.quarantine_reason} />}
        </span>
      ),
    },
    {
      key: 'priority',
      header: 'Priority',
      headerCell: sortHeader('priority', 'Priority'),
      card: 'badge',
      cell: (tc) => <LevelBadge tone={priorityTone(tc.priority)}>{tc.priority}</LevelBadge>,
    },
    {
      key: 'assignee',
      header: 'Assignee',
      tdClassName: 'text-[var(--muted-foreground)]',
      cell: (tc) => (tc.assignee_id ? (usersById.get(tc.assignee_id) ?? 'Unknown') : '—'),
    },
    {
      key: 'module',
      header: 'Module',
      cell: (tc) => (
        <Select
          aria-label={`Module for ${tc.title}`}
          className="h-8 w-36 text-xs max-md:h-11 max-md:w-full max-md:text-base"
          value={tc.module_id ?? ''}
          onChange={(e) => assignModuleMutation.mutate({ id: tc.id, module: e.target.value || null })}
        >
          <option value="">Ungrouped</option>
          {modules.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </Select>
      ),
    },
    { key: 'version', header: 'Version', cell: (tc) => `v${tc.version_number}` },
    { key: 'steps', header: 'Steps', cell: (tc) => tc.steps.length },
  ]

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        back={
          <Link
            to={`/projects/${projectId}`}
            className="inline-flex text-xs text-[var(--muted-foreground)] hover:underline max-md:min-h-11 max-md:items-center max-md:text-sm"
          >
            ← {projectQuery.data?.name ?? 'Project'}
          </Link>
        }
        title="Test Cases"
        description="Write, review and approve the test cases for this project."
        actions={
          <>
            <MoreActionsMenu
              items={[
                { label: 'Quick add', onSelect: () => setQuickOpen(true) },
                { type: 'separator' },
                { label: 'Import CSV', onSelect: () => setImportOpen(true) },
                {
                  label: 'Export CSV',
                  onSelect: () => {
                    window.open(exportUrl(projectId!), '_blank', 'noopener,noreferrer')
                  },
                },
                { label: 'Export Excel (test cases)', onSelect: () => void exportExcel() },
                { type: 'separator' },
                { label: 'Manage Modules', onSelect: () => setModulesOpen(true) },
                { label: 'Templates', onSelect: () => setTemplatesOpen(true) },
                { label: 'Shared Steps', onSelect: () => setSharedStepsOpen(true) },
              ]}
            />
            <Button
              onClick={() => {
                setFormDefaults(DEFAULT_VALUES)
                setCreateOpen(true)
              }}
            >
              New Test Case
            </Button>
          </>
        }
      />

      <FilterTabs
        label="Test case status"
        items={statusTabs}
        value={status}
        onChange={(key) => setFilter('status', key)}
        panelId="tc-panel"
      />

      <ListToolbar
        search={{
          id: 'tc-search',
          value: search,
          onChange: (v) => setFilter('search', v),
          placeholder: 'Search by title…',
        }}
        activeCount={filterChips.length}
        onClearFilters={clearPanelFilters}
        chips={filterChips}
        onRemoveChip={removeChip}
        saved={
          <ViewsMenu
            listKey="test_cases"
            current={{
              filters: compactFilters(urlFilters.values, TC_VIEW_KEYS),
              sort: urlFilters.values.sort === 'created_at' ? null : urlFilters.values.sort,
            }}
            onApply={applyView}
          />
        }
        columns={
          <ColumnVisibilityMenu
            columns={TC_COLUMNS}
            isVisible={columnPrefs.isVisible}
            toggleVisible={columnPrefs.toggleVisible}
            showAll={columnPrefs.showAll}
            density={columnPrefs.density}
            setDensity={columnPrefs.setDensity}
          />
        }
        quick={
          user && (
            // BRD FR-TC-01: one click between everything and my own work. It
            // drives the same `assigneeId` URL filter as the Assignee select.
            <SegmentedToggle
              label="Whose test cases to show"
              value={assigneeId === user.user_id ? 'mine' : 'all'}
              onChange={(v) => setFilter('assigneeId', v === 'mine' ? user.user_id : '')}
              options={[
                { value: 'all', label: 'All cases' },
                { value: 'mine', label: 'Assigned to me' },
              ]}
            />
          )
        }
        filters={
          <>
            <ListFilterField label="Priority">
              <Select
                id="tc-filter-priority"
                aria-label="Priority"
                value={priority}
                onChange={(e) => setFilter('priority', e.target.value)}
              >
                <option value="">All priorities</option>
                {priorityFilterOptions.map((p) => (
                  <option key={p.code} value={p.code}>
                    {p.label}
                  </option>
                ))}
              </Select>
            </ListFilterField>
            <ListFilterField label="Assignee">
              <Select
                id="tc-filter-assignee"
                aria-label="Assignee"
                value={assigneeId}
                onChange={(e) => setFilter('assigneeId', e.target.value)}
              >
                <option value="">All assignees</option>
                {(usersQuery.data ?? []).map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </Select>
            </ListFilterField>
            <ListFilterField label="Module">
              <Select
                id="tc-filter-module"
                aria-label="Module"
                value={moduleId}
                onChange={(e) => setFilter('moduleId', e.target.value)}
              >
                <option value="">All modules</option>
                {modules.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </Select>
            </ListFilterField>
            <ListFilterField label="Quarantine">
              <Select
                id="tc-filter-quarantined"
                aria-label="Quarantine"
                value={quarantined}
                onChange={(e) => setFilter('quarantined', e.target.value)}
              >
                <option value="">Any</option>
                <option value="only">Only quarantined</option>
                <option value="exclude">Exclude quarantined</option>
              </Select>
            </ListFilterField>
            {isMobile && (
              <ListFilterField label="Sort by">
                <Select
                  id="tc-sort"
                  aria-label="Sort by"
                  value={sort}
                  onChange={(e) => urlFilters.setFilters({ sort: e.target.value, page: '1' })}
                >
                  <option value="created_at">Newest</option>
                  <option value="title">Title (A-Z)</option>
                  <option value="-title">Title (Z-A)</option>
                  <option value="status">Status</option>
                  <option value="priority">Priority (A-Z)</option>
                  <option value="-priority">Priority (Z-A)</option>
                </Select>
              </ListFilterField>
            )}
            <label className="flex min-h-11 items-center gap-2 text-sm md:min-h-0">
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

      <div
        id="tc-panel"
        role="tabpanel"
        aria-labelledby={filterTabId('tc-panel', status)}
        className="flex flex-col gap-4"
      >
      <ResponsiveTable
        label="Test cases"
        rows={visibleItems}
        rowKey={(tc) => tc.id}
        columns={columns}
        prefs={columnPrefs}
        rowProps={(tc) => rowDetailProps(() => setDetailRow(tc))}
        selection={bulkEnabled ? bulkSelection : undefined}
        loading={testCasesQuery.isLoading}
        stateCellClassName="px-4"
        state={
          testCasesQuery.isError ? (
            <ErrorState error={testCasesQuery.error} onRetry={() => testCasesQuery.refetch()} />
          ) : testCasesQuery.data && visibleItems.length === 0 ? (
            hiddenCount > 0 || filterChips.length > 0 || search || status ? (
              <EmptyState
                variant="filtered"
                title="No test cases match these filters"
                description={
                  hiddenCount > 0
                    ? `${hiddenCount} deprecated case${hiddenCount === 1 ? ' is' : 's are'} hidden. Tick "Show deprecated" to see ${hiddenCount === 1 ? 'it' : 'them'}.`
                    : 'Try clearing a filter to see more results.'
                }
                action={
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      urlFilters.clearAll()
                      setShowDeprecated(false)
                    }}
                  >
                    Clear filters
                  </Button>
                }
              />
            ) : (
              <EmptyState
                title="No test cases yet"
                description="Test cases describe what to verify, step by step. Write one, then bundle approved cases into a run."
                action={
                  hasPermission(user, 'testcase.create') ? (
                    <Button
                      size="sm"
                      onClick={() => {
                        setFormDefaults(DEFAULT_VALUES)
                        setCreateOpen(true)
                      }}
                    >
                      Create your first test case
                    </Button>
                  ) : undefined
                }
              />
            )
          ) : undefined
        }
      />

      <Pagination
        page={page}
        totalPages={totalPages}
        total={total}
        noun="test case"
        pageSize={PAGE_SIZE}
        onPageChange={setPage}
      />
      </div>

      {selectedCases.size > 0 && bulkEnabled && (
        <TestCaseBulkBar
          selected={selectedCases}
          priorities={priorityFilterOptions}
          users={canListUsers ? (usersQuery.data ?? []) : null}
          modules={modules}
          canEdit={canBulkEdit}
          canQuarantine={canBulkQuarantine}
          onClear={() => updateSelection((next) => next.clear())}
          onFinished={(failedIds) => {
            queryClient.invalidateQueries({ queryKey: ['test-cases', projectId] })
            updateSelection((next) => {
              for (const id of [...next.keys()]) if (!failedIds.includes(id)) next.delete(id)
            })
          }}
        />
      )}

      {/* GAP-91 item 1: a 10+ field form no longer fits well in a centered
          Dialog -- a full-height Drawer gives it real room, same
          focus-trap/Escape/unsaved-changes behavior underneath. */}
      <Drawer open={createOpen} onClose={() => setCreateOpen(false)} title="New Test Case">
        <TestCaseForm
          defaultValues={formDefaults}
          submitLabel="Create Test Case"
          isSubmitting={createMutation.isPending}
          serverError={createError}
          users={usersQuery.data ?? []}
          modules={modulesQuery.data ?? []}
          sharedSteps={sharedStepsQuery.data ?? []}
          onSubmit={(values) => createMutation.mutate(values)}
        />
      </Drawer>

      <QuickCreateTestCaseDialog
        open={quickOpen}
        onClose={() => {
          setQuickOpen(false)
          if (searchParams.has('quick')) {
            searchParams.delete('quick')
            setSearchParams(searchParams, { replace: true })
          }
        }}
        projectId={projectId!}
        modules={modules}
        onMoreOptions={(draft: QuickDraft) => {
          setFormDefaults(draftToFormValues(draft, DEFAULT_VALUES))
          setQuickOpen(false)
          setCreateOpen(true)
        }}
      />

      <RowDetailDrawer row={detailRow} onClose={() => setDetailRow(null)} config={detailConfig} />
      <ImportDialog open={importOpen} onClose={() => setImportOpen(false)} projectId={projectId!} />
      <TemplatesDialog open={templatesOpen} onClose={() => setTemplatesOpen(false)} projectId={projectId!} />
      <SharedStepsDialog
        open={sharedStepsOpen}
        onClose={() => setSharedStepsOpen(false)}
        projectId={projectId!}
      />

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
                  onClick={() =>
                    ask({
                      title: `Delete module “${m.name}”?`,
                      description: `The module is deleted. Its ${m.test_case_count} test case${m.test_case_count === 1 ? '' : 's'} are not deleted, but they lose this module grouping.`,
                      confirmLabel: 'Delete module',
                      run: () => deleteModuleMutation.mutateAsync(m.id),
                    })
                  }
                >
                  Delete
                </Button>
              </li>
            ))}
          </ul>
        </div>
      </Dialog>
      {confirmDialog}
    </div>
  )
}
