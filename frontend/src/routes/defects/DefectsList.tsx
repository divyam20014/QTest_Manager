import { useEffect, useMemo, useState } from 'react'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronDown, ChevronUp, MoreHorizontal } from 'lucide-react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'

import { ApiError } from '@/api/client'
import {
  defectExportPath,
  deleteDefect,
  getDefectColumns,
  getDefectStatusCounts,
  listDefectsPage,
  type Defect,
  type DefectListFilters,
  type DefectStatus,
} from '@/api/defects'
import { listFieldOptions } from '@/api/fieldCustomization'
import { listModules } from '@/api/modules'
import { listProjects } from '@/api/projects'
import { getTestCase } from '@/api/testCases'
import { listUsers } from '@/api/users'
import { type FilterChip } from '@/components/list/FilterChips'
import { CommitTextFilter } from '@/components/list/CommitTextFilter'
import { ListFilterField, ListToolbar } from '@/components/list/ListToolbar'
import { MoreActionsMenu } from '@/components/list/MoreActionsMenu'
import { MultiCheckFilter } from '@/components/list/MultiCheckFilter'
import { RowDetailDrawer, type RowDetailConfig } from '@/components/list/RowDetailDrawer'
import { rowDetailProps } from '@/components/list/rowDetail'
import { ColumnModeMenu } from '@/components/table/ColumnModeMenu'
import { ResponsiveTable, type ResponsiveColumn } from '@/components/table/ResponsiveTable'
import { useRowContextMenu } from '@/components/table/RowContextMenu'
import { useColumnPrefs } from '@/components/table/tablePrefs'
import { ViewsMenu } from '@/components/table/ViewsMenu'
import { compactFilters, useApplyDefaultView, type ViewState } from '@/components/table/viewsHelpers'
import { Button } from '@/components/ui/button'
import { DateRangePicker } from '@/components/ui/date-range-picker'
import { DropdownMenu } from '@/components/ui/dropdown-menu'
import { EmptyState, ErrorState } from '@/components/ui/empty-state'
import { ExportMenu, type ExportMenuItem } from '@/components/ui/ExportMenu'
import { FilterTabs } from '@/components/ui/filter-tabs'
import { filterTabId } from '@/components/ui/filterTabId'
import { IconButton } from '@/components/ui/icon-button'
import { LevelBadge } from '@/components/ui/LevelBadge'
import { PageHeader } from '@/components/ui/PageHeader'
import { Pagination } from '@/components/ui/pagination'
import { SegmentedToggle } from '@/components/ui/segmented'
import { Select } from '@/components/ui/select'
import { useConfirm } from '@/components/ui/useConfirm'
import { useAuth } from '@/lib/auth'
import { MAX_BULK_SELECTION } from '@/lib/bulkActions'
import { exportColumnKeys, defectSortKey, pickerColumns, useDefectColumns } from '@/lib/defectColumns'
import { DEFECT_STATUSES, STATUS_TABS, parseList, statusesForTab, sumStatusCounts, tabKeyForStatuses } from '@/lib/defectWorkflow'
import { formatWhen } from '@/lib/formatWhen'
import { levelTone } from '@/lib/statusTones'
import { useToast } from '@/lib/toast'
import { useCanListUsers } from '@/lib/useCanListUsers'
import { useDebouncedValue } from '@/lib/useDebouncedValue'
import { useIsMobile } from '@/lib/useMediaQuery'
import { useUrlFilters } from '@/lib/useUrlFilters'
import { AssignDialog, RetestDialog, StatusChangeDialog,  type ActionDefect } from './DefectActionDialogs'
import { DefectsBoard } from './DefectsBoard'
import { ViewSwitcher } from '@/components/list/ViewSwitcher'
import { useViewMode, type ViewMode } from '@/lib/viewMode'
import { useDefectPermissions } from '@/lib/useDefectPermissions'
import { ImportWizard } from '@/components/import/ImportWizard'
import { DefectStatusBadge } from './DefectStatusBadge'
import { buildDefectColumn } from './defectCells'
import { TestCasePicker } from './pickers'
import { severityTone } from './statusDisplay'

const PAGE_SIZE = 50
const DEFAULT_SORT = '-created_at'
// ADR-124: a board of defects by status is offered next to the list.
const DEFECT_MODES: readonly ViewMode[] = ['list', 'board']

// ADR-096 / ADR-119: the URL filters a saved view can hold, and the all-cleared state applying one starts from.
const DEFECT_VIEW_KEYS = [
  'search',
  'projectId',
  'status',
  'severity',
  'priority',
  'assigneeId',
  'reportedBy',
  'moduleId',
  'labels',
  'testCaseId',
  'createdFrom',
  'createdTo',
  'fixVersion',
  'environment',
  'resolution',
] as const
const VIEW_RESET = Object.fromEntries(DEFECT_VIEW_KEYS.map((k) => [k, ''])) as Record<string, string>

const filterDefaults = {
  search: '',
  projectId: '',
  status: '',
  severity: '',
  priority: '',
  assigneeId: '',
  reportedBy: '',
  moduleId: '',
  labels: '',
  testCaseId: '',
  createdFrom: '',
  createdTo: '',
  fixVersion: '',
  environment: '',
  resolution: '',
  view: '',
  sort: DEFAULT_SORT,
  page: '1',
}

function toDay(value: string, end: boolean): string | undefined {
  if (!value) return undefined
  return end ? new Date(`${value}T23:59:59`).toISOString() : new Date(value).toISOString()
}

/** The Defects list: all projects at /defects, one project's tab at /defects?projectId=. */
export function DefectsList() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { show: showToast } = useToast()
  const { ask, dialog: confirmDialog } = useConfirm()
  const perms = useDefectPermissions()
  const rowMenu = useRowContextMenu()
  // Widths and density only; which columns show comes from the column modes below.
  const tablePrefs = useColumnPrefs('defects-list-v2', [])
  const catalogQuery = useQuery({ queryKey: ['defects', 'columns'], queryFn: getDefectColumns, staleTime: 5 * 60_000 })
  const catalog = catalogQuery.data
  const cols = useDefectColumns(catalog)

  const urlFilters = useUrlFilters(filterDefaults)
  const v = urlFilters.values
  const applyView = (view: ViewState) => {
    // `view` (list / board) is not reset: a view saved before ADR-124 has none and leaves the mode alone.
    urlFilters.setFilters({ ...VIEW_RESET, ...view.filters, sort: view.sort ?? DEFAULT_SORT, page: '1' })
    // A saved view carries its column layout; older views (no columns) leave the layout as it is.
    if (view.columns && view.columns.length > 0) cols.applyKeys(view.columns)
  }
  useApplyDefaultView('defects', urlFilters.active.length > 0, applyView)

  const { mode: viewMode, setMode: setViewMode } = useViewMode('defects', DEFECT_MODES, {
    raw: v.view,
    set: (value) => urlFilters.setFilters({ view: value }),
  })
  const debouncedSearch = useDebouncedValue(v.search.trim(), 300)
  const sort = v.sort
  const page = Number(v.page) || 1
  const isMobile = useIsMobile()
  const statuses = useMemo(() => parseList(v.status), [v.status])
  const severities = useMemo(() => parseList(v.severity), [v.severity])
  const priorities = useMemo(() => parseList(v.priority), [v.priority])

  const [detailRow, setDetailRow] = useState<Defect | null>(null)
  const [importOpen, setImportOpen] = useState(false)
  const [statusTarget, setStatusTarget] = useState<ActionDefect | null>(null)
  // Set when the board sends a card to a status that needs the dialog (resolution, verification).
  const [statusInitial, setStatusInitial] = useState<DefectStatus | undefined>(undefined)
  const [retestTarget, setRetestTarget] = useState<ActionDefect | null>(null)
  const [assignTarget, setAssignTarget] = useState<ActionDefect | null>(null)

  // The command palette's / dashboard's "Create Defect" quick action lands here with ?action=create.
  const [actionParams] = useSearchParams()
  const wantsCreate = actionParams.get('action') === 'create'
  useEffect(() => {
    if (wantsCreate) navigate(`/defects/new${v.projectId ? `?projectId=${v.projectId}` : ''}`, { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wantsCreate])

  const projectsQuery = useQuery({ queryKey: ['projects', 'all-for-filter'], queryFn: () => listProjects({ page_size: 100, sort: 'name' }) })
  const canListUsers = useCanListUsers()
  const usersQuery = useQuery({ queryKey: ['users'], queryFn: listUsers, enabled: canListUsers })
  const severityOptions = useQuery({ queryKey: ['field-options', 'defect_severity'], queryFn: () => listFieldOptions('defect_severity') })
  const priorityOptions = useQuery({ queryKey: ['field-options', 'defect_priority'], queryFn: () => listFieldOptions('defect_priority') })
  const modulesQuery = useQuery({
    queryKey: ['test-modules', v.projectId],
    queryFn: () => listModules(v.projectId),
    enabled: !!v.projectId,
  })
  const linkedCaseQuery = useQuery({
    queryKey: ['test-cases', 'detail', v.testCaseId],
    queryFn: () => getTestCase(v.testCaseId),
    enabled: !!v.testCaseId,
  })

  // The filters every query shares (the status counts leave `status` out: they feed the tabs).
  const scope: DefectListFilters = {
    search: debouncedSearch || undefined,
    project_id: v.projectId || undefined,
    severity: severities,
    priority: priorities,
    labels: parseList(v.labels),
    assignee_id: v.assigneeId || undefined,
    reported_by: v.reportedBy || undefined,
    module_id: v.moduleId || undefined,
    test_case_id: v.testCaseId || undefined,
    created_from: toDay(v.createdFrom, false),
    created_to: toDay(v.createdTo, true),
    fix_version: v.fixVersion || undefined,
    environment: v.environment || undefined,
    resolution: v.resolution || undefined,
  }
  const filters: DefectListFilters = { ...scope, status: statuses }

  const defectsQuery = useQuery({
    queryKey: ['defects', 'page', filters, sort, page],
    queryFn: () => listDefectsPage({ ...filters, sort, page, page_size: PAGE_SIZE }),
    placeholderData: keepPreviousData,
  })
  const countsQuery = useQuery({
    queryKey: ['defects', 'status-counts', scope],
    queryFn: () => getDefectStatusCounts(scope),
    placeholderData: keepPreviousData,
  })
  const rows = useMemo(() => defectsQuery.data?.items ?? [], [defectsQuery.data])
  const total = defectsQuery.data?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  // A page that no longer exists (rows deleted or moved on) steps back to the last one that does.
  if (defectsQuery.data && defectsQuery.data.items.length === 0 && page > totalPages) {
    urlFilters.setFilter('page', String(totalPages))
  }

  const counts = countsQuery.data?.counts ?? {}
  const tabs = [
    { key: '', label: 'All', count: countsQuery.isSuccess ? countsQuery.data?.total : undefined },
    ...STATUS_TABS.map((t) => ({
      key: t.key,
      label: t.label,
      count: countsQuery.isSuccess ? sumStatusCounts(counts, t.statuses) : undefined,
    })),
  ]
  const tabKey = tabKeyForStatuses(statuses)

  function setFilter(key: keyof typeof filterDefaults, value: string) {
    urlFilters.setFilters({ [key]: value, page: '1' })
  }
  function toggleSort(key: string) {
    const current = sort.replace(/^-/, '')
    const sameColumn = current === key || (key === 'date_reported' && current === 'created_at')
    const next = !sameColumn ? key : sort.startsWith('-') ? key : `-${key}`
    urlFilters.setFilters({ sort: next, page: '1' })
  }

  // ---- chips --------------------------------------------------------------------------------
  const userName = (id: string) => (id === user?.user_id ? 'Me' : (usersQuery.data?.find((u) => u.id === id)?.name ?? id))
  const chips: FilterChip[] = [
    ...(v.projectId ? [{ key: 'projectId', label: 'Project', value: projectsQuery.data?.items.find((p) => p.id === v.projectId)?.name ?? v.projectId }] : []),
    ...(v.status && tabKey === null ? [{ key: 'status', label: 'Status', value: statuses.join(', ') }] : []),
    ...(severities.length ? [{ key: 'severity', label: 'Severity', value: severities.join(', ') }] : []),
    ...(priorities.length ? [{ key: 'priority', label: 'Priority', value: priorities.join(', ') }] : []),
    ...(v.assigneeId ? [{ key: 'assigneeId', label: 'Assignee', value: userName(v.assigneeId) }] : []),
    ...(v.reportedBy ? [{ key: 'reportedBy', label: 'Reporter', value: userName(v.reportedBy) }] : []),
    ...(v.moduleId ? [{ key: 'moduleId', label: 'Module', value: modulesQuery.data?.find((m) => m.id === v.moduleId)?.name ?? v.moduleId }] : []),
    ...(v.labels ? [{ key: 'labels', label: 'Labels', value: v.labels }] : []),
    ...(v.testCaseId ? [{ key: 'testCaseId', label: 'Test case', value: linkedCaseQuery.data?.display_id ?? linkedCaseQuery.data?.title ?? v.testCaseId }] : []),
    ...(v.createdFrom ? [{ key: 'createdFrom', label: 'From', value: v.createdFrom }] : []),
    ...(v.createdTo ? [{ key: 'createdTo', label: 'To', value: v.createdTo }] : []),
    ...(v.fixVersion ? [{ key: 'fixVersion', label: 'Fix version', value: v.fixVersion }] : []),
    ...(v.environment ? [{ key: 'environment', label: 'Environment', value: v.environment }] : []),
    ...(v.resolution ? [{ key: 'resolution', label: 'Resolution', value: v.resolution }] : []),
  ]
  // A status choice that matches a tab is shown by the tab; the project filter is the page's scope.
  const filterCount = chips.length
  function removeChip(key: string) {
    setFilter(key as keyof typeof filterDefaults, '')
  }
  function clearPanelFilters() {
    urlFilters.setFilters({ ...Object.fromEntries(DEFECT_VIEW_KEYS.filter((k) => k !== 'search').map((k) => [k, ''])), page: '1' })
  }

  // ---- selection (export of the chosen rows) ----------------------------------------------------
  const selectionKey = JSON.stringify([filters, sort])
  const [selection, setSelection] = useState<{ key: string; ids: Map<string, string> }>({ key: selectionKey, ids: new Map() })
  const selected = selection.key === selectionKey ? selection.ids : new Map<string, string>()
  function updateSelection(change: (next: Map<string, string>) => void) {
    const next = new Map(selected)
    change(next)
    setSelection({ key: selectionKey, ids: next })
  }
  const capMessage = `You can select at most ${MAX_BULK_SELECTION} defects`
  const rowSelection = perms.canExport
    ? {
        selected: new Set(selected.keys()),
        label: (d: Defect) => `Select ${d.display_id ?? d.title}`,
        onToggle: (id: string) => {
          const d = rows.find((r) => r.id === id)
          if (!d) return
          updateSelection((next) => {
            if (next.has(id)) next.delete(id)
            else if (next.size >= MAX_BULK_SELECTION) showToast('error', capMessage)
            else next.set(id, d.display_id ?? d.title)
          })
        },
        onToggleAll: () => {
          const allOnPage = rows.length > 0 && rows.every((d) => selected.has(d.id))
          updateSelection((next) => {
            if (allOnPage) rows.forEach((d) => next.delete(d.id))
            else {
              for (const d of rows) {
                if (next.size >= MAX_BULK_SELECTION) {
                  showToast('error', capMessage)
                  break
                }
                next.set(d.id, d.display_id ?? d.title)
              }
            }
          })
        },
      }
    : undefined

  // ---- mutations -------------------------------------------------------------------------------
  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteDefect(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['defects'] })
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] })
      showToast('success', 'Defect deleted')
    },
    onError: (err) => showToast('error', err instanceof ApiError ? err.message : 'Could not delete the defect'),
  })

  // ---- columns ---------------------------------------------------------------------------------
  const sortable = catalog?.sortable ?? ['display_id', 'title', 'severity', 'priority', 'status', 'assignee', 'date_reported', 'created_at', 'fix_version']
  const sortHeader = (key: string, label: string) => {
    const current = sort.replace(/^-/, '')
    const isActive = current === key || (key === 'date_reported' && current === 'created_at')
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
  // The list's headers are the short names of the brief; the picker and the export keep the catalogue's full labels.
  const HEADER_LABEL: Record<string, string> = { module: 'Module', fix_version: 'Fix Version' }
  const labelByKey = new Map(pickerColumns(catalog).map((c) => [c.key, HEADER_LABEL[c.key] ?? c.label]))
  const columns: ResponsiveColumn<Defect>[] = cols.keys.map((key) =>
    buildDefectColumn(key, labelByKey.get(key) ?? key, {
      header: sortHeader,
      sortable: (k) => defectSortKey(k, sortable) !== null,
    }),
  )
  const tableColumnPrefs = { isVisible: () => true, width: tablePrefs.width, setWidth: tablePrefs.setWidth, density: tablePrefs.density }

  const asAction = (d: Defect): ActionDefect => ({
    id: d.id,
    status: d.status,
    title: d.title,
    display_id: d.display_id,
    resolution: d.resolution,
    assigned_to: d.assigned_to,
    reported_by: d.reported_by,
    project_id: d.project_id,
  })

  const rowActions = (d: Defect) => (
    <div className="flex justify-end">
      <DropdownMenu
        label={`Actions for ${d.display_id ?? d.title}`}
        items={[
          { label: 'Open', onSelect: () => navigate(`/defects/${d.id}`) },
          ...(perms.canEdit ? [{ label: 'Edit', onSelect: () => navigate(`/defects/${d.id}/edit`) }] : []),
          ...(perms.canAssign && canListUsers ? [{ label: 'Assign', onSelect: () => setAssignTarget(asAction(d)) }] : []),
          ...(perms.canChangeStatus || perms.canClose ? [{ label: 'Change status', onSelect: () => setStatusTarget(asAction(d)) }] : []),
          ...(perms.canDelete
            ? [
                { type: 'separator' as const },
                {
                  label: 'Delete',
                  destructive: true,
                  onSelect: () =>
                    ask({
                      title: `Delete ${d.display_id ?? 'this defect'}?`,
                      description: `"${d.title}" disappears from lists, dashboards and reports. Its history, links and comments are kept.`,
                      confirmLabel: 'Delete defect',
                      run: () => deleteMutation.mutateAsync(d.id),
                    }),
                },
              ]
            : []),
        ]}
        trigger={(props) => (
          <IconButton {...props} tooltipAlign="end" aria-label={`Actions for ${d.display_id ?? d.title}`}>
            <MoreHorizontal aria-hidden="true" />
          </IconButton>
        )}
      />
    </div>
  )

  // ---- export: the current filtered set; "selected columns" maps to `columns=`; chosen rows to `ids=` ----
  const shownExportKeys = exportColumnKeys(cols.keys, catalog?.export_columns)
  const exportItems: ExportMenuItem[] = [
    { label: 'Excel: all fields', path: defectExportPath('xlsx', filters, { sort }), fallbackName: 'defects_export.xlsx' },
    { label: 'Excel: selected columns', path: defectExportPath('xlsx', filters, { sort, columns: shownExportKeys }), fallbackName: 'defects_export.xlsx' },
    { label: 'CSV: all fields', path: defectExportPath('csv', filters, { sort }), fallbackName: 'defects_export.csv' },
    { label: 'CSV: selected columns', path: defectExportPath('csv', filters, { sort, columns: shownExportKeys }), fallbackName: 'defects_export.csv' },
    ...(selected.size > 0
      ? [
          {
            label: `Excel: ${selected.size} selected row${selected.size === 1 ? '' : 's'} (shown columns)`,
            path: defectExportPath('xlsx', {}, { sort, columns: shownExportKeys, ids: [...selected.keys()] }),
            fallbackName: 'defects_export.xlsx',
          },
          {
            label: `CSV: ${selected.size} selected row${selected.size === 1 ? '' : 's'} (shown columns)`,
            path: defectExportPath('csv', {}, { sort, columns: shownExportKeys, ids: [...selected.keys()] }),
            fallbackName: 'defects_export.csv',
          },
        ]
      : []),
  ]

  const detailConfig: RowDetailConfig<Defect> = {
    entity: 'defect',
    title: (d) => d.title,
    badges: (d) => (
      <>
        <DefectStatusBadge status={d.status} label={d.status_label} />
        <LevelBadge tone={severityTone(d.severity)}>{d.severity} severity</LevelBadge>
        <LevelBadge tone={levelTone(d.priority)}>{d.priority} priority</LevelBadge>
      </>
    ),
    fields: (d) => [
      { label: 'Bug ID', value: <span className="font-mono text-xs">{d.display_id ?? d.id.slice(0, 8)}</span> },
      { label: 'Project', value: d.project_name },
      { label: 'Module', value: d.module_name ?? '—' },
      { label: 'Assignee', value: d.assigned_to_name ?? 'Unassigned' },
      { label: 'Reporter', value: d.reported_by_name ?? 'Unknown' },
      { label: 'Environment', value: d.environment ?? '—' },
      { label: 'Fix version', value: d.fix_version ?? '—' },
      { label: 'Resolution', value: d.resolution ?? '—' },
      { label: 'Labels', value: d.labels.length ? d.labels.join(', ') : '—' },
      {
        label: 'Test cases',
        value: d.linked_test_cases.length ? d.linked_test_cases.map((t) => t.display_id ?? t.title).join(', ') : '—',
      },
      { label: 'Reported', value: formatWhen(d.date_reported ?? d.created_at) },
      { label: 'Age', value: d.sla_breached ? 'SLA breached' : `${d.age_days}d` },
    ],
    description: (d) => d.description,
    href: (d) => `/defects/${d.id}`,
  }

  const hasFilters = filterCount > 0 || !!v.search || statuses.length > 0

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Defects"
        description="Track, triage and resolve the defects found during testing."
        actionsClassName="max-md:[&>button:last-child]:flex-1"
        actions={
          <>
            {perms.canExport && <ExportMenu items={exportItems} menuLabel="Export defects" />}
            {perms.canImport && <MoreActionsMenu items={[{ label: 'Import defects', onSelect: () => setImportOpen(true) }]} />}
            <Button
              disabled={!perms.canCreate}
              title={perms.canCreate ? undefined : 'You need the Create defect permission'}
              onClick={() => navigate(`/defects/new${v.projectId ? `?projectId=${v.projectId}` : ''}`)}
            >
              New Defect
            </Button>
          </>
        }
      />

      <FilterTabs
        label="Defect status"
        items={tabs}
        value={tabKey ?? '__custom'}
        onChange={(key) => urlFilters.setFilters({ status: statusesForTab(key).join(','), page: '1' })}
        panelId="defects-panel"
      />

      <ListToolbar
        search={{
          id: 'defect-search',
          value: v.search,
          onChange: (value) => setFilter('search', value),
          placeholder: 'Search Bug ID, title, description or label…',
        }}
        activeCount={filterCount}
        onClearFilters={clearPanelFilters}
        chips={chips}
        onRemoveChip={removeChip}
        saved={
          <ViewsMenu
            listKey="defects"
            current={{
              filters: { ...compactFilters(v, DEFECT_VIEW_KEYS), view: viewMode },
              sort: v.sort === DEFAULT_SORT ? null : v.sort,
              columns: cols.keys,
            }}
            onApply={applyView}
          />
        }
        view={<ViewSwitcher modes={DEFECT_MODES} value={viewMode} onChange={setViewMode} />}
        columns={
          viewMode === 'board' ? undefined : <ColumnModeMenu
            columns={pickerColumns(catalog)}
            keys={cols.keys}
            mode={cols.mode}
            onMode={cols.setMode}
            onToggle={cols.toggle}
            density={tablePrefs.density}
            setDensity={tablePrefs.setDensity}
            idPrefix="defect"
            modeHelp={{
              default: 'The ten standard columns.',
              all: `All ${catalog?.fields.length ?? 22} fields of the defect standard.`,
              custom: 'Tick the columns you want. Save a view to keep this set.',
            }}
          />
        }
        quick={
          user && (
            <SegmentedToggle
              label="Whose defects to show"
              value={v.assigneeId === user.user_id ? 'mine' : 'all'}
              onChange={(value) => setFilter('assigneeId', value === 'mine' ? user.user_id : '')}
              options={[
                { value: 'all', label: 'All defects' },
                { value: 'mine', label: 'Assigned to me' },
              ]}
            />
          )
        }
        filters={
          <>
            <ListFilterField label="Project">
              <Select id="defect-filter-project" aria-label="Filter by project" value={v.projectId} onChange={(e) => urlFilters.setFilters({ projectId: e.target.value, moduleId: '', testCaseId: '', page: '1' })}>
                <option value="">All projects</option>
                {projectsQuery.data?.items.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </ListFilterField>
            <MultiCheckFilter
              legend="Status"
              options={DEFECT_STATUSES.map((s) => ({ value: s, label: s }))}
              value={statuses}
              onChange={(next) => setFilter('status', next.join(','))}
            />
            <MultiCheckFilter
              legend="Severity"
              options={(severityOptions.data ?? []).map((o) => ({ value: o.code, label: o.label }))}
              value={severities}
              onChange={(next) => setFilter('severity', next.join(','))}
            />
            <MultiCheckFilter
              legend="Priority"
              options={(priorityOptions.data ?? []).map((o) => ({ value: o.code, label: o.label }))}
              value={priorities}
              onChange={(next) => setFilter('priority', next.join(','))}
            />
            {canListUsers && (
              <ListFilterField label="Assignee">
                <Select id="defect-filter-assignee" aria-label="Filter by assignee" value={v.assigneeId} onChange={(e) => setFilter('assigneeId', e.target.value)}>
                  <option value="">Anyone</option>
                  {(usersQuery.data ?? []).map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
                </Select>
              </ListFilterField>
            )}
            {canListUsers && (
              <ListFilterField label="Reporter">
                <Select id="defect-filter-reporter" aria-label="Filter by reporter" value={v.reportedBy} onChange={(e) => setFilter('reportedBy', e.target.value)}>
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
              <Select
                id="defect-filter-module"
                aria-label="Filter by module"
                value={v.moduleId}
                disabled={!v.projectId}
                onChange={(e) => setFilter('moduleId', e.target.value)}
              >
                <option value="">{v.projectId ? 'All modules' : 'Choose a project first'}</option>
                {(modulesQuery.data ?? []).map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.parent_id ? `↳ ${m.name}` : m.name}
                  </option>
                ))}
              </Select>
            </ListFilterField>
            <ListFilterField label="Labels (all of, comma separated)">
              <CommitTextFilter key={`l-${v.labels}`} id="defect-filter-labels" label="Labels" placeholder="e.g. regression, checkout" value={v.labels} onCommit={(value) => setFilter('labels', value)} />
            </ListFilterField>
            <ListFilterField label="Linked test case">
              {v.projectId ? (
                <div className="flex flex-col gap-1.5">
                  <TestCasePicker id="defect-filter-case" label="Filter by linked test case" projectId={v.projectId} onPick={(item) => setFilter('testCaseId', item.id)} />
                  {v.testCaseId && (
                    <p className="text-xs text-[var(--muted-foreground)]">
                      Showing defects linked to {linkedCaseQuery.data?.display_id ?? 'the chosen test case'}.
                    </p>
                  )}
                </div>
              ) : (
                <p className="text-xs text-[var(--muted-foreground)]">Choose a project to filter by a test case.</p>
              )}
            </ListFilterField>
            <ListFilterField label="Reported date">
              <DateRangePicker
                idPrefix="defect-reported"
                fromValue={v.createdFrom}
                toValue={v.createdTo}
                onChange={(from, to) => urlFilters.setFilters({ createdFrom: from, createdTo: to, page: '1' })}
              />
            </ListFilterField>
            <ListFilterField label="Fix version">
              <CommitTextFilter key={`f-${v.fixVersion}`} id="defect-filter-fix" label="Fix version" placeholder="e.g. 2.5.0" value={v.fixVersion} onCommit={(value) => setFilter('fixVersion', value)} />
            </ListFilterField>
            <ListFilterField label="Environment contains">
              <CommitTextFilter key={`e-${v.environment}`} id="defect-filter-environment" label="Environment" placeholder="e.g. Staging" value={v.environment} onCommit={(value) => setFilter('environment', value)} />
            </ListFilterField>
            <ListFilterField label="Resolution">
              <Select id="defect-filter-resolution" aria-label="Filter by resolution" value={v.resolution} onChange={(e) => setFilter('resolution', e.target.value)}>
                <option value="">Any resolution</option>
                {(catalog?.resolutions ?? []).map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </Select>
            </ListFilterField>
            {isMobile && (
              <ListFilterField label="Sort by">
                <Select id="defect-sort" aria-label="Sort by" value={v.sort} onChange={(e) => urlFilters.setFilters({ sort: e.target.value, page: '1' })}>
                  <option value="-created_at">Newest</option>
                  <option value="created_at">Oldest</option>
                  <option value="-severity">Severity (highest first)</option>
                  <option value="-priority">Priority (highest first)</option>
                  <option value="-status">Status (furthest along first)</option>
                  <option value="title">Title (A-Z)</option>
                  <option value="display_id">Bug ID (low to high)</option>
                  <option value="-display_id">Bug ID (high to low)</option>
                </Select>
              </ListFilterField>
            )}
          </>
        }
      />

      <div id="defects-panel" role="tabpanel" aria-labelledby={tabKey !== null ? filterTabId('defects-panel', tabKey) : undefined} className="flex flex-col gap-4">
        {viewMode === 'board' ? (
          <DefectsBoard
            scope={scope}
            statuses={statuses}
            counts={counts}
            catalog={catalog}
            onNeedStatusDialog={(d, target) => {
              setStatusInitial(target as DefectStatus)
              setStatusTarget(d)
            }}
            onNeedRetest={setRetestTarget}
          />
        ) : (
        <>
        <ResponsiveTable
          label="Defects"
          dense
          rows={rows}
          rowKey={(d) => d.id}
          columns={columns}
          prefs={tableColumnPrefs}
          rowProps={(d) => rowDetailProps(() => setDetailRow(d))}
          rowActions={rowActions}
          selection={rowSelection}
          loading={defectsQuery.isLoading}
          stateCellClassName="px-4"
          onRowContextMenu={(e, d) =>
            rowMenu.openAt(e, [
              { label: 'Open', onSelect: () => navigate(`/defects/${d.id}`) },
              {
                label: 'Copy Bug ID',
                onSelect: () => {
                  void navigator.clipboard?.writeText(d.display_id ?? d.id)
                },
              },
            ])
          }
          state={
            defectsQuery.isError ? (
              <ErrorState error={defectsQuery.error} onRetry={() => defectsQuery.refetch()} />
            ) : defectsQuery.data && rows.length === 0 ? (
              hasFilters ? (
                <EmptyState
                  variant="filtered"
                  title="No defects match your filters"
                  description="Try clearing a filter to see more results."
                  action={
                    <Button variant="outline" size="sm" onClick={() => urlFilters.clearAll()}>
                      Clear filters
                    </Button>
                  }
                />
              ) : (
                <EmptyState
                  title="No defects yet"
                  description="Defects reported from a failed test step, or created directly, will show up here."
                  action={
                    perms.canCreate ? (
                      <Link to="/defects/new" className="text-sm text-[var(--link)] underline underline-offset-2">
                        Report the first defect
                      </Link>
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
          noun="defect"
          pageSize={PAGE_SIZE}
          onPageChange={(next) => urlFilters.setFilter('page', String(Math.max(1, next)))}
        />
        </>
        )}
      </div>
      {rowMenu.menu}
      <RowDetailDrawer row={detailRow} onClose={() => setDetailRow(null)} config={detailConfig} />
      <ImportWizard
        open={importOpen}
        onClose={() => setImportOpen(false)}
        kind="defect"
        noun="defect"
        projectId={v.projectId || null}
        projects={projectsQuery.data?.items ?? []}
        viewHref={(id) => `/defects?projectId=${id}`}
      />
      <StatusChangeDialog
        defect={statusTarget}
        initialTarget={statusInitial}
        onClose={() => {
          setStatusTarget(null)
          setStatusInitial(undefined)
        }}
      />
      <RetestDialog defect={retestTarget} onClose={() => setRetestTarget(null)} />
      <AssignDialog defect={assignTarget} onClose={() => setAssignTarget(null)} />
      {confirmDialog}
    </div>
  )
}
