import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'

import { ApiError } from '@/api/client'
import { createDefect, listDefects, type DefectStatus, type Priority, type Severity } from '@/api/defects'
import { listFieldOptions } from '@/api/fieldCustomization'
import { listProjects } from '@/api/projects'
import { listUsers } from '@/api/users'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { DateRangePicker } from '@/components/ui/date-range-picker'
import { Dialog } from '@/components/ui/dialog'
import { EmptyState, ErrorState } from '@/components/ui/empty-state'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { TableSkeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { ColumnVisibilityMenu } from '@/components/table/ColumnVisibilityMenu'
import { ResizableTh } from '@/components/table/ResizableTh'
import { useRowContextMenu, type RowContextMenuItem } from '@/components/table/RowContextMenu'
import { SavedFiltersMenu } from '@/components/table/SavedFiltersMenu'
import { useColumnPrefs, useSavedFilters, type TableColumnDef } from '@/components/table/tablePrefs'
import { useAuth } from '@/lib/auth'
import { useToast } from '@/lib/toast'
import { useUrlFilters } from '@/lib/useUrlFilters'
import { DefectImportDialog } from './DefectImportDialog'
import { STATUS_ORDER, STATUS_TONE, severityTone } from './statusDisplay'

const DEFECT_COLUMNS: TableColumnDef[] = [
  { key: 'title', label: 'Title', alwaysVisible: true, defaultWidth: 280 },
  { key: 'project', label: 'Project', defaultWidth: 140 },
  { key: 'severity', label: 'Severity', defaultWidth: 110 },
  { key: 'priority', label: 'Priority', defaultWidth: 100 },
  { key: 'status', label: 'Status', alwaysVisible: true, defaultWidth: 130 },
  { key: 'sla', label: 'SLA', defaultWidth: 100 },
  { key: 'reportedBy', label: 'Reported By', defaultWidth: 140 },
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
  const projectId = urlFilters.values.projectId
  const status = urlFilters.values.status as DefectStatus | ''
  const severity = urlFilters.values.severity as Severity | ''
  const reportedBy = urlFilters.values.reportedBy
  const createdFrom = urlFilters.values.createdFrom
  const createdTo = urlFilters.values.createdTo
  const [createOpen, setCreateOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
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
  const usersQuery = useQuery({ queryKey: ['users'], queryFn: listUsers })
  const severitiesQuery = useQuery({
    queryKey: ['field-options', 'defect_severity'],
    queryFn: () => listFieldOptions('defect_severity'),
  })
  const defectsQuery = useQuery({
    queryKey: ['defects', projectId, status, severity, reportedBy, createdFrom, createdTo],
    queryFn: () =>
      listDefects({
        project_id: projectId || undefined,
        status: status || undefined,
        severity: severity || undefined,
        reported_by: reportedBy || undefined,
        created_from: createdFrom ? new Date(createdFrom).toISOString() : undefined,
        created_to: createdTo ? new Date(createdTo + 'T23:59:59').toISOString() : undefined,
      }),
  })

  // defect.create is granted to every role (admin/manager/tester) per
  // ADR-014's seed, so this is a contextual action available uniformly --
  // not role-gated, matching the backend permission it calls.
  const canCreate = !!user

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Defects</h1>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setImportOpen(true)}>
            Import
          </Button>
          {canCreate && <Button onClick={() => setCreateOpen(true)}>New Defect</Button>}
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <Select
          aria-label="Filter by project"
          value={projectId}
          onChange={(e) => urlFilters.setFilter('projectId', e.target.value)}
          className="w-56"
        >
          <option value="">All Projects</option>
          {projectsQuery.data?.items.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>
        <Select
          aria-label="Filter by status"
          value={status}
          onChange={(e) => urlFilters.setFilter('status', e.target.value)}
          className="w-40"
        >
          <option value="">All Statuses</option>
          {STATUS_ORDER.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </Select>
        <Select
          aria-label="Filter by severity"
          value={severity}
          onChange={(e) => urlFilters.setFilter('severity', e.target.value)}
          className="w-40"
        >
          <option value="">All Severities</option>
          {(severitiesQuery.data ?? []).map((s) => (
            <option key={s.code} value={s.code}>
              {s.label}
            </option>
          ))}
        </Select>
        <Select
          aria-label="Filter by reporter"
          value={reportedBy}
          onChange={(e) => urlFilters.setFilter('reportedBy', e.target.value)}
          className="w-44"
        >
          <option value="">All Reporters</option>
          {usersQuery.data?.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </Select>
        <DateRangePicker
          idPrefix="defect-reported"
          fromValue={createdFrom}
          toValue={createdTo}
          onChange={(from, to) => {
            urlFilters.setFilter('createdFrom', from)
            urlFilters.setFilter('createdTo', to)
          }}
        />
        {urlFilters.active.length > 0 && (
          <Button variant="ghost" size="sm" onClick={urlFilters.clearAll}>
            Clear filters
          </Button>
        )}
        <div className="ml-auto flex items-end gap-2 pb-0.5">
          <SavedFiltersMenu
            current={urlFilters.values}
            saved={savedFilters.saved}
            onSave={savedFilters.save}
            onApply={(f) => urlFilters.setFilters(f)}
            onRemove={savedFilters.remove}
          />
          <ColumnVisibilityMenu
            columns={DEFECT_COLUMNS}
            isVisible={columnPrefs.isVisible}
            toggleVisible={columnPrefs.toggleVisible}
            showAll={columnPrefs.showAll}
          />
        </div>
      </div>

      {urlFilters.active.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {urlFilters.active.map((key) => (
            <span
              key={key}
              className="inline-flex items-center gap-1 rounded-full bg-[var(--muted)] px-2.5 py-1 text-xs"
            >
              {DEFECT_FILTER_CHIP_LABEL[key]}: {urlFilters.values[key]}
              <button
                type="button"
                onClick={() => urlFilters.setFilter(key, '')}
                aria-label={`Remove ${DEFECT_FILTER_CHIP_LABEL[key]} filter`}
                className="text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border border-[var(--border)]">
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10 bg-[var(--muted)] text-left text-xs text-[var(--muted-foreground)]">
            <tr>
              <ResizableTh width={columnPrefs.width('title')} onResize={(w) => columnPrefs.setWidth('title', w)}>
                Title
              </ResizableTh>
              {columnPrefs.isVisible('project') && (
                <ResizableTh width={columnPrefs.width('project')} onResize={(w) => columnPrefs.setWidth('project', w)}>
                  Project
                </ResizableTh>
              )}
              {columnPrefs.isVisible('severity') && (
                <ResizableTh width={columnPrefs.width('severity')} onResize={(w) => columnPrefs.setWidth('severity', w)}>
                  Severity
                </ResizableTh>
              )}
              {columnPrefs.isVisible('priority') && (
                <ResizableTh width={columnPrefs.width('priority')} onResize={(w) => columnPrefs.setWidth('priority', w)}>
                  Priority
                </ResizableTh>
              )}
              <ResizableTh width={columnPrefs.width('status')} onResize={(w) => columnPrefs.setWidth('status', w)}>
                Status
              </ResizableTh>
              {columnPrefs.isVisible('sla') && (
                <ResizableTh width={columnPrefs.width('sla')} onResize={(w) => columnPrefs.setWidth('sla', w)}>
                  SLA
                </ResizableTh>
              )}
              {columnPrefs.isVisible('reportedBy') && (
                <ResizableTh width={columnPrefs.width('reportedBy')} onResize={(w) => columnPrefs.setWidth('reportedBy', w)}>
                  Reported By
                </ResizableTh>
              )}
              {columnPrefs.isVisible('reported') && (
                <ResizableTh width={columnPrefs.width('reported')} onResize={(w) => columnPrefs.setWidth('reported', w)}>
                  Reported
                </ResizableTh>
              )}
            </tr>
          </thead>
          <tbody>
            {defectsQuery.isLoading && <TableSkeleton columns={8} />}
            {defectsQuery.isError && (
              <tr>
                <td colSpan={8} className="px-4">
                  <ErrorState onRetry={() => defectsQuery.refetch()} />
                </td>
              </tr>
            )}
            {!defectsQuery.isLoading && !defectsQuery.isError && defectsQuery.data?.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4">
                  <EmptyState
                    title={status || severity || reportedBy || createdFrom || createdTo ? 'No defects match your filters' : 'No defects yet'}
                    description={
                      status || severity || reportedBy || createdFrom || createdTo
                        ? 'Try clearing a filter to see more results.'
                        : 'Defects reported from a failed test step, or created directly, will show up here.'
                    }
                  />
                </td>
              </tr>
            )}
            {defectsQuery.data?.map((d) => {
              const contextItems: RowContextMenuItem[] = [
                { label: 'Open', onSelect: () => navigate(`/defects/${d.id}`) },
                {
                  label: 'Copy defect ID',
                  onSelect: () => {
                    void navigator.clipboard?.writeText(d.id)
                  },
                },
              ]
              return (
                <tr
                  key={d.id}
                  className="border-t border-[var(--border)] hover:bg-[var(--muted)]"
                  onContextMenu={(e) => rowMenu.openAt(e, contextItems)}
                >
                  <td className="px-4 py-2" style={{ maxWidth: columnPrefs.width('title') }}>
                    <Link
                      to={`/defects/${d.id}`}
                      className="block truncate font-medium underline-offset-2 hover:underline"
                    >
                      {d.title}
                    </Link>
                    {d.step_number !== null && (
                      <span className="ml-2 text-xs text-[var(--muted-foreground)]">step {d.step_number}</span>
                    )}
                  </td>
                  {columnPrefs.isVisible('project') && (
                    <td className="truncate px-4 py-2" style={{ maxWidth: columnPrefs.width('project') }}>
                      {d.project_name}
                    </td>
                  )}
                  {columnPrefs.isVisible('severity') && (
                    <td className="px-4 py-2">
                      <Badge tone={severityTone(d.severity)}>{d.severity}</Badge>
                    </td>
                  )}
                  {columnPrefs.isVisible('priority') && (
                    <td className="px-4 py-2 text-xs text-[var(--muted-foreground)]">{d.priority}</td>
                  )}
                  <td className="px-4 py-2">
                    <Badge tone={STATUS_TONE[d.status]}>{d.status_label}</Badge>
                  </td>
                  {columnPrefs.isVisible('sla') && (
                    <td className="px-4 py-2">
                      {d.sla_breached ? (
                        <Badge tone="critical">Breached</Badge>
                      ) : (
                        <span className="text-xs text-[var(--muted-foreground)]">{d.age_days}d</span>
                      )}
                    </td>
                  )}
                  {columnPrefs.isVisible('reportedBy') && (
                    <td className="truncate px-4 py-2 text-xs text-[var(--muted-foreground)]" style={{ maxWidth: columnPrefs.width('reportedBy') }}>
                      {d.reported_by_name ?? 'Unknown'}
                    </td>
                  )}
                  {columnPrefs.isVisible('reported') && (
                    <td className="px-4 py-2 text-xs text-[var(--muted-foreground)]">
                      {new Date(d.created_at).toLocaleDateString()}
                    </td>
                  )}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {rowMenu.menu}

      <NewDefectDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        projects={projectsQuery.data?.items ?? []}
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
  onCreated,
}: {
  open: boolean
  onClose: () => void
  projects: { id: string; name: string }[]
  onCreated: () => void
}) {
  const [projectId, setProjectId] = useState('')
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
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="new-defect-project">Project</Label>
          <Select id="new-defect-project" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
            <option value="">Select a project…</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="new-defect-title">Title</Label>
          <Input id="new-defect-title" value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="new-defect-severity">Severity</Label>
          <Select
            id="new-defect-severity"
            value={severity}
            onChange={(e) => setSeverity(e.target.value as Severity)}
          >
            {(severitiesQuery.data ?? []).map((s) => (
              <option key={s.code} value={s.code}>
                {s.label}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="new-defect-priority">Priority</Label>
          <Select
            id="new-defect-priority"
            value={priority}
            onChange={(e) => setPriority(e.target.value as Priority)}
          >
            {(prioritiesQuery.data ?? []).map((p) => (
              <option key={p.code} value={p.code}>
                {p.label}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="new-defect-description">Description</Label>
          <Textarea
            id="new-defect-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
        {serverError && <p className="text-xs text-[var(--destructive)]">{serverError}</p>}
        <div className="flex justify-end gap-2">
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
        </div>
      </div>
    </Dialog>
  )
}
