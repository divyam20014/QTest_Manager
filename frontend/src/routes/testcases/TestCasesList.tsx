import { useMemo, useState } from 'react'
import { keepPreviousData, useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronDown, ChevronUp, MoreHorizontal } from 'lucide-react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'

import { ApiError } from '@/api/client'
import { createModule, deleteModule, listModules } from '@/api/modules'
import { getProject } from '@/api/projects'
import {
  AUTOMATION_STATUSES,
  EXECUTION_STATUSES,
  deleteTestCase,
  duplicateTestCase,
  getTestCaseColumns,
  listTestCases,
  testCaseExportPath,
  type TestCase,
  type TestCaseListParams,
  type TestCaseStatus,
} from '@/api/testCases'
import { listUsers } from '@/api/users'
import { listFieldOptions } from '@/api/fieldCustomization'
import { exportUrl } from '@/api/csvImport'
import { MoreActionsMenu } from '@/components/list/MoreActionsMenu'
import { CommitTextFilter } from '@/components/list/CommitTextFilter'
import { ListFilterField, ListToolbar } from '@/components/list/ListToolbar'
import { RowDetailDrawer, type RowDetailConfig } from '@/components/list/RowDetailDrawer'
import { rowDetailProps } from '@/components/list/rowDetail'
import { buildStatusTabs } from '@/components/list/statusTabs'
import { FilterTabs } from '@/components/ui/filter-tabs'
import { filterTabId } from '@/components/ui/filterTabId'
import { LevelBadge } from '@/components/ui/LevelBadge'
import { Pagination } from '@/components/ui/pagination'
import { ViewsMenu } from '@/components/table/ViewsMenu'
import { useColumnPrefs } from '@/components/table/tablePrefs'
import { hasPermission } from '@/api/auth'
import { MAX_BULK_SELECTION } from '@/lib/bulkActions'
import { TestCaseBulkBar, type BulkSelectedCase } from './TestCaseBulkBar'
import { compactFilters, useApplyDefaultView, type ViewState } from '@/components/table/viewsHelpers'
import { ResponsiveTable, type ResponsiveColumn } from '@/components/table/ResponsiveTable'
import { QuarantinedBadge } from '@/components/ui/QuarantinedBadge'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { PageHeader } from '@/components/ui/PageHeader'
import { EmptyState, ErrorState } from '@/components/ui/empty-state'
import { Button } from '@/components/ui/button'
import { DropdownMenu } from '@/components/ui/dropdown-menu'
import { ExportMenu } from '@/components/ui/ExportMenu'
import { IconButton } from '@/components/ui/icon-button'
import { useConfirm } from '@/components/ui/useConfirm'
import { Dialog } from '@/components/ui/dialog'
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
import { exportKeyFor, pickerColumns, useTestCaseColumns } from '@/lib/testCaseColumns'
import { ImportWizard } from '@/components/import/ImportWizard'
import { SharedStepsDialog } from './SharedStepsDialog'
import { TemplatesDialog } from './TemplatesDialog'
import { draftToPrefill, type QuickDraft } from '@/lib/quickCase'
import { QuickCreateTestCaseDialog } from './QuickCreateTestCaseDialog'
import { ExecutionStatusBadge } from './ExecutionStatusBadge'
import { TestCaseColumnMenu } from './TestCaseColumnMenu'
import { buildTestCaseColumn } from './testCaseCells'
import { formatWhen } from '@/lib/formatWhen'
import { STATUS_DISPLAY } from './statusDisplay'
import { levelTone } from '@/lib/statusTones'

const STATUSES: TestCaseStatus[] = ['draft', 'ready_for_review', 'approved', 'deprecated']
const PAGE_SIZE = 25

// ADR-096 / ADR-117: the URL filters a saved view can hold, and the all-cleared state applying one starts from.
const TC_VIEW_KEYS = [
  'search',
  'priority',
  'status',
  'assigneeId',
  'moduleId',
  'quarantined',
  'testType',
  'severity',
  'automationStatus',
  'environment',
  'executionStatus',
  'executedBy',
] as const
const TC_VIEW_RESET = Object.fromEntries(TC_VIEW_KEYS.map((k) => [k, ''])) as Record<string, string>

export function TestCasesList() {
  const { projectId } = useParams<{ projectId: string }>()
  const navigate = useNavigate()
  // ADR-106: quick-create dialog; the dashboard's 'New test case' opens it via ?quick=1.
  const [searchParams, setSearchParams] = useSearchParams()
  const [quickOpen, setQuickOpen] = useState(searchParams.get('quick') === '1')
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
  // Widths and density only; which columns show comes from the column modes below.
  const tablePrefs = useColumnPrefs('test-cases-list', [])
  const canCreate = hasPermission(user, 'testcase.create')
  const canEdit = hasPermission(user, 'testcase.edit')
  const canDelete = hasPermission(user, 'testcase.delete')
  const canExport = hasPermission(user, 'testcase.export') || hasPermission(user, 'testcase.bulk_import_export')
  const canImport = hasPermission(user, 'testcase.bulk_import_export') || canCreate

  const catalogQuery = useQuery({ queryKey: ['test-cases', 'columns'], queryFn: getTestCaseColumns, staleTime: 5 * 60_000 })
  const catalog = catalogQuery.data
  const cols = useTestCaseColumns(catalog)

  // Bug #13: filters persist in the URL (shareable, survives refresh) instead of component state.
  const filterDefaults = useMemo(
    () => ({
      search: '',
      priority: '',
      status: '',
      assigneeId: '',
      moduleId: '',
      quarantined: '',
      testType: '',
      severity: '',
      automationStatus: '',
      environment: '',
      executionStatus: '',
      executedBy: '',
      sort: 'created_at',
      page: '1',
    }),
    [],
  )
  const urlFilters = useUrlFilters(filterDefaults)
  const applyView = (view: ViewState) => {
    urlFilters.setFilters({ ...TC_VIEW_RESET, ...view.filters, sort: view.sort ?? 'created_at', page: '1' })
    // A saved view carries its column layout; older views (no columns) leave the layout as it is.
    if (view.columns && view.columns.length > 0) cols.applyKeys(view.columns)
  }
  useApplyDefaultView('test_cases', urlFilters.active.length > 0, applyView)
  const v = urlFilters.values
  const search = v.search
  const priority = v.priority
  const status = v.status as TestCaseStatus | ''
  const assigneeId = v.assigneeId
  const moduleId = v.moduleId
  const quarantined = v.quarantined as '' | 'only' | 'exclude'
  const sort = v.sort
  const page = Number(v.page) || 1
  // Bug #8: deprecated cases cluttered the list by default -- hidden unless toggled on or filtered to Deprecated.
  const [showDeprecated, setShowDeprecated] = useState(false)
  const isMobile = useIsMobile()

  // The filters every query below shares (the tabs and the count queries vary `status`).
  const baseParams: TestCaseListParams = {
    search,
    priority,
    assignee_id: assigneeId,
    module_id: moduleId || undefined,
    quarantined: quarantined || undefined,
    test_type: v.testType,
    severity: v.severity,
    automation_status: v.automationStatus,
    environment: v.environment,
    execution_status: v.executionStatus,
    executed_by: v.executedBy,
  }

  const priorityOptionsQuery = useQuery({ queryKey: ['field-options', 'test_case_priority'], queryFn: () => listFieldOptions('test_case_priority') })
  const typeOptionsQuery = useQuery({ queryKey: ['field-options', 'test_type'], queryFn: () => listFieldOptions('test_type') })
  const severityOptionsQuery = useQuery({ queryKey: ['field-options', 'test_case_severity'], queryFn: () => listFieldOptions('test_case_severity') })
  const priorityFilterOptions: { code: string; label: string }[] = (priorityOptionsQuery.data ?? []).map((o) => ({
    code: o.code,
    label: o.label,
  }))

  const projectQuery = useQuery({ queryKey: ['projects', projectId], queryFn: () => getProject(projectId!), enabled: !!projectId })
  const canListUsers = useCanListUsers()
  const usersQuery = useQuery({ queryKey: ['users'], queryFn: listUsers, enabled: canListUsers })
  const modulesQuery = useQuery({ queryKey: ['test-modules', projectId], queryFn: () => listModules(projectId!), enabled: !!projectId })
  const testCasesQuery = useQuery({
    queryKey: ['test-cases', projectId, { ...baseParams, status, sort, page }],
    queryFn: () => listTestCases(projectId!, { ...baseParams, status, sort, page, page_size: PAGE_SIZE }),
    enabled: !!projectId,
    placeholderData: keepPreviousData,
  })

  const createModuleMutation = useMutation({
    mutationFn: () => createModule(projectId!, { name: newModuleName }),
    onSuccess: () => {
      setNewModuleName('')
      queryClient.invalidateQueries({ queryKey: ['test-modules', projectId] })
    },
    onError: (err) => showToast('error', err instanceof ApiError ? err.message : 'Could not create module'),
  })

  const deleteModuleMutation = useMutation({
    mutationFn: (id: string) => deleteModule(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['test-modules', projectId] })
      queryClient.invalidateQueries({ queryKey: ['test-cases', projectId] })
      showToast('success', 'Module deleted')
    },
    onError: (err) => showToast('error', err instanceof ApiError ? err.message : 'Could not delete that module'),
  })

  const duplicateMutation = useMutation({
    mutationFn: (id: string) => duplicateTestCase(id),
    onSuccess: (copy) => {
      queryClient.invalidateQueries({ queryKey: ['test-cases', projectId] })
      showToast('success', `Duplicated as ${copy.display_id ?? 'a new draft'}`)
      navigate(`/test-cases/${copy.id}`)
    },
    onError: (err) => showToast('error', err instanceof ApiError ? err.message : 'Could not duplicate the test case'),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteTestCase(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['test-cases', projectId] })
      showToast('success', 'Test case deleted')
    },
    onError: (err) => showToast('error', err instanceof ApiError ? err.message : 'Could not delete the test case'),
  })

  const usersById = new Map((usersQuery.data ?? []).map((u) => [u.id, u.name]))
  const modules = modulesQuery.data ?? []

  const total = testCasesQuery.data?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  type FilterKey = keyof typeof filterDefaults
  function setFilter(key: FilterKey, value: string) {
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
    ...(v.testType ? [{ key: 'testType', label: 'Test type', value: v.testType }] : []),
    ...(v.severity ? [{ key: 'severity', label: 'Severity', value: v.severity }] : []),
    ...(v.automationStatus ? [{ key: 'automationStatus', label: 'Automation', value: v.automationStatus }] : []),
    ...(v.environment ? [{ key: 'environment', label: 'Environment', value: v.environment }] : []),
    ...(v.executionStatus ? [{ key: 'executionStatus', label: 'Execution status', value: v.executionStatus }] : []),
    ...(v.executedBy
      ? [{ key: 'executedBy', label: 'Executed by', value: usersQuery.data?.find((u) => u.id === v.executedBy)?.name ?? v.executedBy }]
      : []),
    ...(assigneeId
      ? [
          {
            key: 'assigneeId',
            label: 'Assignee',
            value: assigneeId === user?.user_id ? 'Me' : (usersQuery.data?.find((u) => u.id === assigneeId)?.name ?? assigneeId),
          },
        ]
      : []),
    ...(moduleId ? [{ key: 'moduleId', label: 'Module', value: modules.find((m) => m.id === moduleId)?.name ?? moduleId }] : []),
    ...(quarantined ? [{ key: 'quarantined', label: 'Quarantine', value: quarantined === 'only' ? 'Only quarantined' : 'Hide quarantined' }] : []),
    ...(showDeprecated ? [{ key: 'deprecated', label: 'Deprecated', value: 'Shown' }] : []),
  ]
  function removeChip(key: string) {
    if (key === 'deprecated') setShowDeprecated(false)
    else setFilter(key as FilterKey, '')
  }
  // Clears the filters in the panel; the search box and the review-status tab have their own controls.
  function clearPanelFilters() {
    urlFilters.setFilters({
      priority: '',
      assigneeId: '',
      moduleId: '',
      quarantined: '',
      testType: '',
      severity: '',
      automationStatus: '',
      environment: '',
      executionStatus: '',
      executedBy: '',
      page: '1',
    })
    setShowDeprecated(false)
  }

  // Review-status tab counts: one one-row request per tab (only `total` is read) under the other filters.
  const countKeys: (TestCaseStatus | '')[] = ['', ...STATUSES]
  const countQueries = useQueries({
    queries: countKeys.map((key) => ({
      queryKey: ['test-cases', projectId, 'status-count', { key, ...baseParams }],
      queryFn: () => listTestCases(projectId!, { ...baseParams, status: key, page_size: 1 }).then((r) => r.total),
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
        <ExecutionStatusBadge status={tc.execution_status} />
        <StatusBadge tone={STATUS_DISPLAY[tc.status].tone}>Review: {tc.review_status_label ?? tc.status_label}</StatusBadge>
        <LevelBadge tone={levelTone(tc.priority)}>{tc.priority} priority</LevelBadge>
        {tc.quarantined && <QuarantinedBadge title={tc.quarantine_reason} />}
      </>
    ),
    fields: (tc) => [
      { label: 'Test Case ID', value: <span className="font-mono text-xs">{tc.display_id ?? tc.id.slice(0, 8)}</span> },
      { label: 'Project', value: projectQuery.data?.name ?? '—' },
      { label: 'Module', value: tc.module_path ?? 'Ungrouped' },
      { label: 'Test type', value: tc.test_type ?? '—' },
      { label: 'Severity', value: tc.severity ?? '—' },
      { label: 'Automation', value: tc.automation_status ?? '—' },
      { label: 'Environment', value: tc.environment ?? '—' },
      { label: 'Requirement', value: tc.requirement_ref ?? '—' },
      { label: 'Assignee', value: tc.assignee_id ? (usersById.get(tc.assignee_id) ?? 'Unknown') : 'Unassigned' },
      { label: 'Executed by', value: tc.last_executed_by ?? '—' },
      { label: 'Last execution', value: formatWhen(tc.last_executed_at) },
      { label: 'Version', value: `v${tc.version_number}` },
      { label: 'Steps', value: tc.steps.length },
      { label: 'Created', value: new Date(tc.created_at).toLocaleDateString() },
    ],
    description: (tc) => tc.description,
    href: (tc) => `/test-cases/${tc.id}`,
  }

  const allItems = testCasesQuery.data?.items ?? []
  const visibleItems = allItems.filter((tc) => showDeprecated || status === 'deprecated' || tc.status !== 'deprecated')
  const hiddenCount = allItems.length - visibleItems.length

  // ADR-105 bulk selection: kept across pages while the filters are unchanged, cleared when they change (the key below).
  const selectionKey = JSON.stringify([projectId, baseParams, status, showDeprecated])
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
  const canBulkEdit = canEdit
  const canBulkQuarantine = hasPermission(user, 'testcase.approve')
  const bulkEnabled = canBulkEdit || canBulkQuarantine

  const sortableKeys = new Set(catalog?.sortable ?? ['created_at', 'title', 'priority', 'status', 'display_id'])
  const sortHeader = (key: string, label: string) => {
    const isActive = sort.replace(/^-/, '') === key
    return (
      <button
        type="button"
        className="flex items-center gap-1 hover:text-[var(--foreground)]"
        aria-label={`Sort by ${label}${isActive ? (sort.startsWith('-') ? ', descending' : ', ascending') : ''}`}
        onClick={() => toggleSort(key)}
      >
        {label}
        {isActive && (sort.startsWith('-') ? <ChevronDown className="size-3.5" /> : <ChevronUp className="size-3.5" />)}
      </button>
    )
  }

  const labelByKey = new Map(pickerColumns(catalog).map((c) => [c.key, c.label]))
  const columns: ResponsiveColumn<TestCase>[] = cols.keys.map((key) =>
    buildTestCaseColumn(key, labelByKey.get(key) ?? key, {
      usersById,
      header: sortHeader,
      sortable: (k) => sortableKeys.has(k),
    }),
  )
  const tableColumnPrefs = {
    isVisible: () => true,
    width: tablePrefs.width,
    setWidth: tablePrefs.setWidth,
    density: tablePrefs.density,
  }

  const rowActions = (tc: TestCase) => (
    <div className="flex justify-end">
      <DropdownMenu
        label={`Actions for ${tc.display_id ?? tc.title}`}
        items={[
          { label: 'Open', onSelect: () => navigate(`/test-cases/${tc.id}`) },
          ...(canEdit ? [{ label: 'Edit', onSelect: () => navigate(`/test-cases/${tc.id}/edit`) }] : []),
          ...(canCreate ? [{ label: 'Duplicate', onSelect: () => duplicateMutation.mutate(tc.id) }] : []),
          ...(canDelete
            ? [
                { type: 'separator' as const },
                {
                  label: 'Delete',
                  destructive: true,
                  onSelect: () =>
                    ask({
                      title: `Delete ${tc.display_id ?? 'this test case'}?`,
                      description: `"${tc.title}" is removed from lists, search and reports. Its runs, defects and history are kept.`,
                      confirmLabel: 'Delete test case',
                      run: () => deleteMutation.mutateAsync(tc.id),
                    }),
                },
              ]
            : []),
        ]}
        trigger={(props) => (
          <IconButton {...props} tooltipAlign="end" aria-label={`Actions for ${tc.display_id ?? tc.title}`}>
            <MoreHorizontal aria-hidden="true" />
          </IconButton>
        )}
      />
    </div>
  )

  // The export is the current filtered set; "Selected columns" maps to `columns=`.
  const exportParams: TestCaseListParams = { ...baseParams, status, sort }
  const selectedExportColumns = cols.keys.map(exportKeyFor)
  const exportItems = projectId
    ? [
        { label: 'Excel: all fields', path: testCaseExportPath(projectId, 'xlsx', exportParams), fallbackName: 'test_cases_export.xlsx' },
        {
          label: 'Excel: selected columns',
          path: testCaseExportPath(projectId, 'xlsx', exportParams, selectedExportColumns),
          fallbackName: 'test_cases_export.xlsx',
        },
        { label: 'CSV: all fields', path: testCaseExportPath(projectId, 'csv', exportParams), fallbackName: 'test_cases_export.csv' },
        {
          label: 'CSV: selected columns',
          path: testCaseExportPath(projectId, 'csv', exportParams, selectedExportColumns),
          fallbackName: 'test_cases_export.csv',
        },
      ]
    : []

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
            {canExport && <ExportMenu items={exportItems} menuLabel="Export test cases" />}
            <MoreActionsMenu
              items={[
                ...(canCreate ? [{ label: 'Quick add', onSelect: () => setQuickOpen(true) }, { type: 'separator' as const }] : []),
                ...(canImport ? [{ label: 'Import test cases', onSelect: () => setImportOpen(true) }] : []),
                {
                  label: 'Export CSV (legacy columns)',
                  onSelect: () => {
                    window.open(exportUrl(projectId!), '_blank', 'noopener,noreferrer')
                  },
                },
                { type: 'separator' },
                { label: 'Manage Modules', onSelect: () => setModulesOpen(true) },
                { label: 'Templates', onSelect: () => setTemplatesOpen(true) },
                { label: 'Shared Steps', onSelect: () => setSharedStepsOpen(true) },
              ]}
            />
            <Button
              disabled={!canCreate}
              title={canCreate ? undefined : 'You need the Create test case permission'}
              onClick={() => navigate(`/projects/${projectId}/test-cases/new`)}
            >
              New Test Case
            </Button>
          </>
        }
      />

      <FilterTabs
        label="Review status"
        items={statusTabs}
        value={status}
        onChange={(key) => setFilter('status', key)}
        panelId="tc-panel"
      />

      <ListToolbar
        search={{
          id: 'tc-search',
          value: search,
          onChange: (value) => setFilter('search', value),
          placeholder: 'Search by ID, title, requirement or module…',
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
              columns: cols.keys,
            }}
            onApply={applyView}
          />
        }
        columns={
          <TestCaseColumnMenu
            catalog={catalog}
            keys={cols.keys}
            mode={cols.mode}
            onMode={cols.setMode}
            onToggle={cols.toggle}
            density={tablePrefs.density}
            setDensity={tablePrefs.setDensity}
          />
        }
        quick={
          user && (
            // BRD FR-TC-01: one click between everything and my own work. It drives the same `assigneeId` URL filter.
            <SegmentedToggle
              label="Whose test cases to show"
              value={assigneeId === user.user_id ? 'mine' : 'all'}
              onChange={(value) => setFilter('assigneeId', value === 'mine' ? user.user_id : '')}
              options={[
                { value: 'all', label: 'All cases' },
                { value: 'mine', label: 'Assigned to me' },
              ]}
            />
          )
        }
        filters={
          <>
            <ListFilterField label="Test type">
              <Select id="tc-filter-type" aria-label="Test type" value={v.testType} onChange={(e) => setFilter('testType', e.target.value)}>
                <option value="">All test types</option>
                {(typeOptionsQuery.data ?? []).map((o) => (
                  <option key={o.code} value={o.code}>
                    {o.label}
                  </option>
                ))}
              </Select>
            </ListFilterField>
            <ListFilterField label="Priority">
              <Select id="tc-filter-priority" aria-label="Priority" value={priority} onChange={(e) => setFilter('priority', e.target.value)}>
                <option value="">All priorities</option>
                {priorityFilterOptions.map((p) => (
                  <option key={p.code} value={p.code}>
                    {p.label}
                  </option>
                ))}
              </Select>
            </ListFilterField>
            <ListFilterField label="Severity">
              <Select id="tc-filter-severity" aria-label="Severity" value={v.severity} onChange={(e) => setFilter('severity', e.target.value)}>
                <option value="">All severities</option>
                {(severityOptionsQuery.data ?? []).map((o) => (
                  <option key={o.code} value={o.code}>
                    {o.label}
                  </option>
                ))}
              </Select>
            </ListFilterField>
            <ListFilterField label="Automation status">
              <Select
                id="tc-filter-automation"
                aria-label="Automation status"
                value={v.automationStatus}
                onChange={(e) => setFilter('automationStatus', e.target.value)}
              >
                <option value="">Any automation status</option>
                {AUTOMATION_STATUSES.map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
              </Select>
            </ListFilterField>
            <ListFilterField label="Environment">
              <CommitTextFilter
                key={v.environment}
                id="tc-filter-environment"
                label="Environment"
                placeholder="e.g. QA"
                value={v.environment}
                onCommit={(value) => setFilter('environment', value)}
              />
            </ListFilterField>
            <ListFilterField label="Execution status">
              <Select
                id="tc-filter-execution"
                aria-label="Execution status"
                value={v.executionStatus}
                onChange={(e) => setFilter('executionStatus', e.target.value)}
              >
                <option value="">Any execution status</option>
                {EXECUTION_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </Select>
            </ListFilterField>
            {canListUsers && (
              <ListFilterField label="Executed by">
                <Select
                  id="tc-filter-executed-by"
                  aria-label="Executed by"
                  value={v.executedBy}
                  onChange={(e) => setFilter('executedBy', e.target.value)}
                >
                  <option value="">Anyone</option>
                  {(usersQuery.data ?? []).map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
                </Select>
              </ListFilterField>
            )}
            <ListFilterField label="Module">
              <Select id="tc-filter-module" aria-label="Module" value={moduleId} onChange={(e) => setFilter('moduleId', e.target.value)}>
                <option value="">All modules</option>
                {modules.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.parent_id ? `↳ ${m.name}` : m.name}
                  </option>
                ))}
              </Select>
            </ListFilterField>
            <ListFilterField label="Review status">
              <Select id="tc-filter-review" aria-label="Review status" value={status} onChange={(e) => setFilter('status', e.target.value)}>
                <option value="">Any review status</option>
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {STATUS_DISPLAY[s].label}
                  </option>
                ))}
              </Select>
            </ListFilterField>
            {canListUsers && (
              <ListFilterField label="Assignee">
                <Select id="tc-filter-assignee" aria-label="Assignee" value={assigneeId} onChange={(e) => setFilter('assigneeId', e.target.value)}>
                  <option value="">All assignees</option>
                  {(usersQuery.data ?? []).map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
                </Select>
              </ListFilterField>
            )}
            <ListFilterField label="Quarantine">
              <Select id="tc-filter-quarantined" aria-label="Quarantine" value={quarantined} onChange={(e) => setFilter('quarantined', e.target.value)}>
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
                  <option value="display_id">Test Case ID (low to high)</option>
                  <option value="-display_id">Test Case ID (high to low)</option>
                  <option value="priority">Priority (A-Z)</option>
                  <option value="-priority">Priority (Z-A)</option>
                  <option value="-last_executed_at">Last executed (newest)</option>
                </Select>
              </ListFilterField>
            )}
            <label className="flex min-h-11 items-center gap-2 text-sm md:min-h-0">
              <input type="checkbox" checked={showDeprecated} onChange={(e) => setShowDeprecated(e.target.checked)} />
              Show deprecated
            </label>
          </>
        }
      />

      <div id="tc-panel" role="tabpanel" aria-labelledby={filterTabId('tc-panel', status)} className="flex flex-col gap-4">
        <ResponsiveTable
          label="Test cases"
          rows={visibleItems}
          rowKey={(tc) => tc.id}
          columns={columns}
          prefs={tableColumnPrefs}
          rowProps={(tc) => rowDetailProps(() => setDetailRow(tc))}
          rowActions={rowActions}
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
                    canCreate ? (
                      <Button size="sm" onClick={() => navigate(`/projects/${projectId}/test-cases/new`)}>
                        Create your first test case
                      </Button>
                    ) : undefined
                  }
                />
              )
            ) : undefined
          }
        />

        <Pagination page={page} totalPages={totalPages} total={total} noun="test case" pageSize={PAGE_SIZE} onPageChange={setPage} />
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
          setQuickOpen(false)
          navigate(`/projects/${projectId}/test-cases/new`, { state: { prefill: draftToPrefill(draft) } })
        }}
      />

      <RowDetailDrawer row={detailRow} onClose={() => setDetailRow(null)} config={detailConfig} />
      <ImportWizard
        open={importOpen}
        onClose={() => setImportOpen(false)}
        kind="test_case"
        noun="test case"
        projectId={projectId!}
        viewHref={(id) => `/projects/${id}/test-cases`}
        allowMapped
      />
      <TemplatesDialog open={templatesOpen} onClose={() => setTemplatesOpen(false)} projectId={projectId!} />
      <SharedStepsDialog open={sharedStepsOpen} onClose={() => setSharedStepsOpen(false)} projectId={projectId!} />

      <Dialog open={modulesOpen} onClose={() => setModulesOpen(false)} title="Manage Modules">
        <div className="flex flex-col gap-3 text-sm">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="new-module-name">New module name</Label>
            <div className="flex gap-2">
              <Input id="new-module-name" value={newModuleName} onChange={(e) => setNewModuleName(e.target.value)} />
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
            {modules.length === 0 && <li className="text-xs text-[var(--muted-foreground)]">No modules yet.</li>}
            {modules.map((m) => (
              <li key={m.id} className="flex items-center justify-between rounded-md border border-[var(--border)] px-3 py-2">
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
