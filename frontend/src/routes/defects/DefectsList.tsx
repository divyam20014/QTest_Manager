import { useEffect, useMemo, useState } from 'react'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'

import { ApiError } from '@/api/client'
import { createDefect, getDefectStatusCounts, listDefectsPage, type Defect, type DefectStatus, type Priority, type Severity } from '@/api/defects'
import { listFieldOptions } from '@/api/fieldCustomization'
import { listProjects } from '@/api/projects'
import { listUsers } from '@/api/users'
import { Badge } from '@/components/ui/badge'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { PageHeader } from '@/components/ui/PageHeader'
import { Button } from '@/components/ui/button'
import { DateRangePicker } from '@/components/ui/date-range-picker'
import { Dialog, DialogFooter } from '@/components/ui/dialog'
import { EmptyState, ErrorState } from '@/components/ui/empty-state'
import { FilterTabs } from '@/components/ui/filter-tabs'
import { LevelBadge } from '@/components/ui/LevelBadge'
import { ListFilterField, ListToolbar } from '@/components/list/ListToolbar'
import { RowDetailDrawer, type RowDetailConfig } from '@/components/list/RowDetailDrawer'
import { rowDetailProps } from '@/components/list/rowDetail'
import { buildStatusTabs } from '@/components/list/statusTabs'
import { filterTabId } from '@/components/ui/filterTabId'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { ColumnVisibilityMenu } from '@/components/table/ColumnVisibilityMenu'
import { Pagination } from '@/components/ui/pagination'
import { CARD_LINK_CLASS, ResponsiveTable, type ResponsiveColumn } from '@/components/table/ResponsiveTable'
import { useRowContextMenu } from '@/components/table/RowContextMenu'
import { SavedFiltersMenu } from '@/components/table/SavedFiltersMenu'
import { ViewsMenu } from '@/components/table/ViewsMenu'
import { compactFilters, useApplyDefaultView, type ViewState } from '@/components/table/viewsHelpers'
import { useColumnPrefs, useSavedFilters, type TableColumnDef } from '@/components/table/tablePrefs'
import { useAuth } from '@/lib/auth'
import { useToast } from '@/lib/toast'
import { useUrlFilters } from '@/lib/useUrlFilters'
import { useCanListUsers } from '@/lib/useCanListUsers'
import { useDebouncedValue } from '@/lib/useDebouncedValue'
import { MoreActionsMenu } from '@/components/list/MoreActionsMenu'
import { FormError, FormField } from '@/components/ui/form-field'
import { ReportDirty } from '@/components/ui/dirtyForm'
import { DefectImportDialog } from './DefectImportDialog'
import { levelTone } from '@/lib/statusTones'
import { STATUS_ORDER, STATUS_TONE, severityTone } from './statusDisplay'

const DEFECT_COLUMNS: TableColumnDef[] = [
  { key: 'title', label: 'Title', alwaysVisible: true, defaultWidth: 280 },
  { key: 'project', label: 'Project', defaultWidth: 140 },
  { key: 'severity', label: 'Severity', defaultWidth: 110 },
  { key: 'priority', label: 'Priority', defaultWidth: 100 },
  { key: 'status', label: 'Status', alwaysVisible: true, defaultWidth: 130 },
  { key: 'sla', label: 'SLA', defaultWidth: 100, defaultHidden: true },
  { key: 'reportedBy', label: 'Reported By', defaultWidth: 140, defaultHidden: true },
  { key: 'reported', label: 'Reported', defaultWidth: 110 },
]

const DEFECT_FILTER_CHIP_LABEL: Record<string, string> = {
  projectId: 'Project',
  status: 'Status',
  severity: 'Severity',
  reportedBy: 'Reported By',
  createdFrom: 'From',
  createdTo: 'To',
}

// One definition feeds the desktop table and the phone cards (ResponsiveTable).
const DEFECT_TABLE_COLUMNS: ResponsiveColumn<Defect>[] = [
  {
    key: 'title',
    header: 'Title',
    limitWidth: true,
    card: 'title',
    cell: (d) => (
      <>
        <Link to={`/defects/${d.id}`} className="block truncate font-medium underline-offset-2 hover:underline">
          {d.title}
        </Link>
        {d.step_number !== null && (
          <span className="ml-2 text-xs text-[var(--muted-foreground)]">step {d.step_number}</span>
        )}
      </>
    ),
    cardCell: (d) => (
      <>
        <Link to={`/defects/${d.id}`} className={CARD_LINK_CLASS}>
          {d.title}
        </Link>
        {d.step_number !== null && (
          <span className="text-xs text-[var(--muted-foreground)]">Found at step {d.step_number}</span>
        )}
      </>
    ),
  },
  { key: 'project', header: 'Project', limitWidth: true, tdClassName: 'truncate', cell: (d) => d.project_name },
  {
    key: 'severity',
    header: 'Severity',
    card: 'badge',
    cell: (d) => <LevelBadge tone={severityTone(d.severity)}>{d.severity}</LevelBadge>,
  },
  {
    key: 'priority',
    header: 'Priority',
    cell: (d) => <LevelBadge tone={levelTone(d.priority)}>{d.priority}</LevelBadge>,
  },
  {
    key: 'status',
    header: 'Status',
    card: 'badge',
    cell: (d) => <StatusBadge tone={STATUS_TONE[d.status]}>{d.status_label}</StatusBadge>,
  },
  {
    key: 'sla',
    header: 'SLA',
    cardLabel: 'Age',
    cell: (d) =>
      d.sla_breached ? (
        <Badge tone="critical">Breached</Badge>
      ) : (
        <span className="text-xs text-[var(--muted-foreground)]">{d.age_days}d</span>
      ),
  },
  {
    key: 'reportedBy',
    header: 'Reported By',
    limitWidth: true,
    tdClassName: 'truncate text-xs text-[var(--muted-foreground)]',
    cell: (d) => d.reported_by_name ?? 'Unknown',
  },
  {
    key: 'reported',
    header: 'Reported',
    tdClassName: 'text-xs text-[var(--muted-foreground)]',
    cell: (d) => new Date(d.created_at).toLocaleDateString(),
  },
]

const DEFECTS_PAGE_SIZE = 50

const DEFECT_DETAIL: RowDetailConfig<Defect> = {
  entity: 'defect',
  title: (d) => d.title,
  badges: (d) => (
    <>
      <StatusBadge tone={STATUS_TONE[d.status]}>{d.status_label}</StatusBadge>
      <LevelBadge tone={severityTone(d.severity)}>{d.severity} severity</LevelBadge>
    </>
  ),
  fields: (d) => [
    { label: 'ID', value: <span className="font-mono text-xs">{d.id.slice(0, 8)}</span> },
    { label: 'Priority', value: <LevelBadge tone={levelTone(d.priority)}>{d.priority}</LevelBadge> },
    { label: 'Assignee', value: d.assigned_to_name ?? 'Unassigned' },
    { label: 'Reported by', value: d.reported_by_name ?? 'Unknown' },
    { label: 'Project', value: d.project_name },
    { label: 'Reported', value: new Date(d.created_at).toLocaleDateString() },
    { label: 'Age', value: d.sla_breached ? 'SLA breached' : `${d.age_days}d` },
  ],
  description: (d) => d.description,
  href: (d) => `/defects/${d.id}`,
}

// ADR-096: the URL filters a saved view can hold, and the all-cleared state applying one starts from.
const DEFECT_VIEW_KEYS = ['search', 'projectId', 'status', 'severity', 'reportedBy', 'createdFrom', 'createdTo'] as const
const CLEARED_FILTERS = { projectId: '', severity: '', reportedBy: '', createdFrom: '', createdTo: '' }
const DEFECT_VIEW_RESET = Object.fromEntries(DEFECT_VIEW_KEYS.map((k) => [k, ''])) as Record<string, string>

export function DefectsList() {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const columnPrefs = useColumnPrefs('defects-list', DEFECT_COLUMNS)
  const savedFilters = useSavedFilters<Record<string, string>>('defects-list')
  const rowMenu = useRowContextMenu()
  // Bug #13 / Pass C deferred item #3: filters persist in the URL now,
  // including making the Dashboard's `?severity=Critical` deep link
  // actually pre-filter on landing (it previously went nowhere).
  const filterDefaults = useMemo(
    () => ({
      search: '',
      projectId: '',
      status: '',
      severity: '',
      reportedBy: '',
      createdFrom: '',
      createdTo: '',
    }),
    [],
  )
  const urlFilters = useUrlFilters(filterDefaults)
  const applyView = (view: ViewState) =>
    urlFilters.setFilters({ ...DEFECT_VIEW_RESET, ...view.filters })
  useApplyDefaultView('defects', urlFilters.active.length > 0, applyView)
  const search = urlFilters.values.search
  const debouncedSearch = useDebouncedValue(search.trim(), 300)
  const projectId = urlFilters.values.projectId
  const status = urlFilters.values.status as DefectStatus | ''
  const severity = urlFilters.values.severity as Severity | ''
  const reportedBy = urlFilters.values.reportedBy
  const createdFrom = urlFilters.values.createdFrom
  const createdTo = urlFilters.values.createdTo
  const [createOpen, setCreateOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [detailRow, setDetailRow] = useState<Defect | null>(null)
  const [actionParams, setActionParams] = useSearchParams()

  // Phase 2: the command palette's "Create Defect" quick action
  // navigates here with ?action=create -- reuses this existing create
  // dialog rather than inventing a new creation flow.
  useEffect(() => {
    if (actionParams.get('action') === 'create') {
      setCreateOpen(true)
      setActionParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          next.delete('action')
          return next
        },
        { replace: true },
      )
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actionParams])

  const projectsQuery = useQuery({
    queryKey: ['projects', 'all-for-filter'],
    queryFn: () => listProjects({ page_size: 100, sort: 'name' }),
  })
  const canListUsers = useCanListUsers()
  const usersQuery = useQuery({ queryKey: ['users'], queryFn: listUsers, enabled: canListUsers })
  const severitiesQuery = useQuery({
    queryKey: ['field-options', 'defect_severity'],
    queryFn: () => listFieldOptions('defect_severity'),
  })
  // ADR-078: the server pages the list (50 per page, newest first) and counts the matching
  // defects per status, so only one page of rows is ever downloaded however many defects exist.
  const activeStatus = (STATUS_ORDER as string[]).includes(status) ? status : ''
  // Status has its own control (the tabs), so it is not a chip and does not
  // count towards the Filters badge.
  const chipKeys = urlFilters.active.filter((key) => key !== 'status' && key !== 'search')
  const otherFiltersActive = Boolean(projectId || severity || reportedBy || createdFrom || createdTo)
  const filterKey = [debouncedSearch, projectId, status, severity, reportedBy, createdFrom, createdTo].join('|')
  const [paging, setPaging] = useState({ key: filterKey, page: 1 })
  // The page resets to 1 when any filter (or the status tab) changes.
  const page = paging.key === filterKey ? paging.page : 1
  const scopeParams = {
    search: debouncedSearch || undefined,
    project_id: projectId || undefined,
    severity: severity || undefined,
    reported_by: reportedBy || undefined,
    created_from: createdFrom ? new Date(createdFrom).toISOString() : undefined,
    created_to: createdTo ? new Date(createdTo + 'T23:59:59').toISOString() : undefined,
  }
  const defectsQuery = useQuery({
    queryKey: ['defects', 'page', debouncedSearch, projectId, severity, reportedBy, createdFrom, createdTo, activeStatus, page],
    queryFn: () =>
      listDefectsPage({
        ...scopeParams,
        status: activeStatus || undefined,
        page,
        page_size: DEFECTS_PAGE_SIZE,
      }),
    placeholderData: keepPreviousData,
  })
  const countsQuery = useQuery({
    queryKey: ['defects', 'status-counts', debouncedSearch, projectId, severity, reportedBy, createdFrom, createdTo],
    queryFn: () => getDefectStatusCounts(scopeParams),
    placeholderData: keepPreviousData,
  })
  const pageRows = useMemo(() => defectsQuery.data?.items ?? [], [defectsQuery.data])
  const totalMatching = defectsQuery.data?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(totalMatching / DEFECTS_PAGE_SIZE))
  // Defects can be deleted or moved between statuses while on a later page: if that page
  // no longer exists, step back to the last one that does.
  if (defectsQuery.data && defectsQuery.data.items.length === 0 && page > totalPages) {
    setPaging({ key: filterKey, page: totalPages })
  }
  const countsReady = countsQuery.isSuccess
  const statusCounts = countsQuery.data?.counts ?? {}
  const statusTabs = buildStatusTabs({
    order: STATUS_ORDER,
    counts: statusCounts,
    total: countsQuery.data?.total,
    ready: countsReady,
  })
  const clearOtherFilters = () => urlFilters.setFilters(CLEARED_FILTERS)
  const chips = chipKeys.map((key) => ({
    key,
    label: DEFECT_FILTER_CHIP_LABEL[key],
    value: chipValue(key),
  }))
  function chipValue(key: string): string {
    const raw = (urlFilters.values as Record<string, string>)[key]
    if (key === 'projectId') return projectsQuery.data?.items.find((p) => p.id === raw)?.name ?? raw
    if (key === 'reportedBy') return usersQuery.data?.find((u) => u.id === raw)?.name ?? raw
    return raw
  }
  // defect.create is granted to every role (admin/manager/tester) per
  // ADR-014's seed, so this is a contextual action available uniformly --
  // not role-gated, matching the backend permission it calls.
  const canCreate = !!user

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Defects"
        description="Track, triage and resolve the defects found during testing."
        actions={
          <>
            <MoreActionsMenu items={[{ label: 'Import defects', onSelect: () => setImportOpen(true) }]} />
            {canCreate && <Button onClick={() => setCreateOpen(true)}>New Defect</Button>}
          </>
        }
      />

      <FilterTabs
        label="Defect status"
        items={statusTabs}
        value={activeStatus}
        onChange={(key) => urlFilters.setFilter('status', key)}
        panelId="defects-panel"
      />

      <ListToolbar
        search={{
          id: 'defect-search',
          value: search,
          onChange: (v) => urlFilters.setFilter('search', v),
          placeholder: 'Search defects by title…',
        }}
        activeCount={chipKeys.length}
        onClearFilters={clearOtherFilters}
        chips={chips}
        onRemoveChip={(key) => urlFilters.setFilter(key as keyof typeof urlFilters.values, '')}
        saved={
          <>
            <SavedFiltersMenu
              current={urlFilters.values}
              saved={savedFilters.saved}
              onSave={savedFilters.save}
              onApply={(f) => urlFilters.setFilters(f)}
              onRemove={savedFilters.remove}
            />
            <ViewsMenu
              listKey="defects"
              current={{ filters: compactFilters(urlFilters.values, DEFECT_VIEW_KEYS), sort: null }}
              onApply={applyView}
            />
          </>
        }
        columns={
          <ColumnVisibilityMenu
            columns={DEFECT_COLUMNS}
            isVisible={columnPrefs.isVisible}
            toggleVisible={columnPrefs.toggleVisible}
            showAll={columnPrefs.showAll}
            density={columnPrefs.density}
            setDensity={columnPrefs.setDensity}
          />
        }
        filters={
          <>
            <ListFilterField label="Project">
              <Select
                aria-label="Filter by project"
                value={projectId}
                onChange={(e) => urlFilters.setFilter('projectId', e.target.value)}
              >
                <option value="">All Projects</option>
                {projectsQuery.data?.items.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </ListFilterField>
            <ListFilterField label="Severity">
              <Select
                aria-label="Filter by severity"
                value={severity}
                onChange={(e) => urlFilters.setFilter('severity', e.target.value)}
              >
                <option value="">All Severities</option>
                {(severitiesQuery.data ?? []).map((s) => (
                  <option key={s.code} value={s.code}>
                    {s.label}
                  </option>
                ))}
              </Select>
            </ListFilterField>
            <ListFilterField label="Reported by">
              <Select
                aria-label="Filter by reporter"
                value={reportedBy}
                onChange={(e) => urlFilters.setFilter('reportedBy', e.target.value)}
              >
                <option value="">All Reporters</option>
                {usersQuery.data?.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </Select>
            </ListFilterField>
            <ListFilterField label="Reported date">
              <DateRangePicker
                idPrefix="defect-reported"
                fromValue={createdFrom}
                toValue={createdTo}
                onChange={(from, to) => urlFilters.setFilters({ createdFrom: from, createdTo: to })}
              />
            </ListFilterField>
          </>
        }
      />

      <div
        id="defects-panel"
        role="tabpanel"
        aria-labelledby={filterTabId('defects-panel', activeStatus)}
        className="flex flex-col gap-4"
      >
      <ResponsiveTable
        label="Defects"
        rows={pageRows}
        rowKey={(d) => d.id}
        columns={DEFECT_TABLE_COLUMNS}
        prefs={columnPrefs}
        rowProps={(d) => rowDetailProps(() => setDetailRow(d))}
        loading={defectsQuery.isLoading}
        onRowContextMenu={(e, d) =>
          rowMenu.openAt(e, [
            { label: 'Open', onSelect: () => navigate(`/defects/${d.id}`) },
            {
              label: 'Copy defect ID',
              onSelect: () => {
                void navigator.clipboard?.writeText(d.id)
              },
            },
          ])
        }
        state={
          defectsQuery.isError ? (
            <ErrorState error={defectsQuery.error} onRetry={() => defectsQuery.refetch()} />
          ) : !defectsQuery.isLoading && totalMatching === 0 ? (
            <EmptyState
              title={
                otherFiltersActive || search
                  ? 'No defects match your filters'
                  : activeStatus
                    ? `No ${activeStatus} defects`
                    : 'No defects yet'
              }
              variant={otherFiltersActive || search ? 'filtered' : 'empty'}
              action={
                otherFiltersActive || search ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => urlFilters.setFilters({ ...CLEARED_FILTERS, search: '' })}
                  >
                    Clear filters
                  </Button>
                ) : undefined
              }
              description={
                otherFiltersActive || search
                  ? 'Try clearing a filter to see more results.'
                  : activeStatus
                    ? 'No defect is in this status right now. Pick another tab to see the rest.'
                  : 'Defects reported from a failed test step, or created directly, will show up here.'
              }
            />
          ) : undefined
        }
      />
      <Pagination
        page={page}
        totalPages={totalPages}
        total={totalMatching}
        noun="defect"
        pageSize={DEFECTS_PAGE_SIZE}
        onPageChange={(next) => setPaging({ key: filterKey, page: next })}
      />
      </div>
      {rowMenu.menu}
      <RowDetailDrawer row={detailRow} onClose={() => setDetailRow(null)} config={DEFECT_DETAIL} />

      <NewDefectDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        projects={projectsQuery.data?.items ?? []}
        defaultProjectId={projectId}
        onCreated={() => queryClient.invalidateQueries({ queryKey: ['defects'] })}
      />
      <DefectImportDialog open={importOpen} onClose={() => setImportOpen(false)} />
    </div>
  )
}

function NewDefectDialog({
  open,
  onClose,
  projects,
  defaultProjectId = '',
  onCreated,
}: {
  open: boolean
  onClose: () => void
  projects: { id: string; name: string }[]
  /** Preselected project (e.g. from the project Dashboard quick action). */
  defaultProjectId?: string
  onCreated: () => void
}) {
  const [projectId, setProjectId] = useState(defaultProjectId)
  const [title, setTitle] = useState('')
  const [severity, setSeverity] = useState<Severity>('Medium')
  const [priority, setPriority] = useState<Priority>('Medium')
  const [description, setDescription] = useState('')
  const severitiesQuery = useQuery({
    queryKey: ['field-options', 'defect_severity'],
    queryFn: () => listFieldOptions('defect_severity'),
  })
  const prioritiesQuery = useQuery({
    queryKey: ['field-options', 'defect_priority'],
    queryFn: () => listFieldOptions('defect_priority'),
  })

  const { show: showToast } = useToast()
  const createMutation = useMutation({
    mutationFn: () => createDefect({ project_id: projectId, title, severity, priority, description }),
    onSuccess: () => {
      onCreated()
      setProjectId('')
      setTitle('')
      setSeverity('Medium')
      setPriority('Medium')
      setDescription('')
      onClose()
      // Deliberately distinct from the "Defect created" history-entry
      // label shown on the defect detail page -- matching text caused a
      // real strict-mode locator collision elsewhere in this pass.
      showToast('success', 'New defect created')
    },
    // No onError toast -- `serverError` below already renders this inline,
    // avoiding the duplicate-text strict-mode-locator problem confirmed by
    // a real Playwright failure elsewhere in this pass.
  })
  const serverError = createMutation.error instanceof ApiError ? createMutation.error.message : null

  return (
    <Dialog open={open} onClose={onClose} title="New Defect">
      <div className="flex flex-col gap-3 text-sm">
        <ReportDirty dirty={projectId !== '' || title !== '' || description !== ''} />
        <FormField id="new-defect-project" label="Project" required>
          {(field) => (
            <Select {...field} value={projectId} onChange={(e) => setProjectId(e.target.value)}>
              <option value="">Select a project…</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          )}
        </FormField>
        <FormField id="new-defect-title" label="Title" required>
          {(field) => <Input {...field} value={title} onChange={(e) => setTitle(e.target.value)} />}
        </FormField>
        <FormField id="new-defect-severity" label="Severity">
          {(field) => (
            <Select {...field} value={severity} onChange={(e) => setSeverity(e.target.value as Severity)}>
              {(severitiesQuery.data ?? []).map((s) => (
                <option key={s.code} value={s.code}>
                  {s.label}
                </option>
              ))}
            </Select>
          )}
        </FormField>
        <FormField id="new-defect-priority" label="Priority">
          {(field) => (
            <Select {...field} value={priority} onChange={(e) => setPriority(e.target.value as Priority)}>
              {(prioritiesQuery.data ?? []).map((p) => (
                <option key={p.code} value={p.code}>
                  {p.label}
                </option>
              ))}
            </Select>
          )}
        </FormField>
        <FormField id="new-defect-description" label="Description">
          {(field) => (
            <Textarea {...field} value={description} onChange={(e) => setDescription(e.target.value)} />
          )}
        </FormField>
        <FormError>{serverError}</FormError>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            size="sm"
            disabled={!projectId || !title || createMutation.isPending}
            onClick={() => createMutation.mutate()}
          >
            {createMutation.isPending ? 'Creating…' : 'Create Defect'}
          </Button>
        </DialogFooter>
      </div>
    </Dialog>
  )
}
