import { useEffect, useMemo, useState } from 'react'
import { hasPermission } from '@/api/auth'
import { useAuth } from '@/lib/auth'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'

import { ApiError } from '@/api/client'
import {
  createTestRun,
  listTestRuns,
  type RunType,
  type TestRunCreateRequest,
  type TestRunSummary,
} from '@/api/execution'
import { getProject } from '@/api/projects'
import { listTestCases } from '@/api/testCases'
import { ColumnVisibilityMenu } from '@/components/table/ColumnVisibilityMenu'
import { useColumnPrefs, type TableColumnDef } from '@/components/table/tablePrefs'
import { CARD_LINK_CLASS, ResponsiveTable, type ResponsiveColumn } from '@/components/table/ResponsiveTable'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { FilterTabs } from '@/components/ui/filter-tabs'
import { filterTabId } from '@/components/ui/filterTabId'
import { ListFilterField, ListToolbar } from '@/components/list/ListToolbar'
import { RowDetailDrawer, type RowDetailConfig } from '@/components/list/RowDetailDrawer'
import { rowDetailProps } from '@/components/list/rowDetail'
import { buildStatusTabs } from '@/components/list/statusTabs'
import { RUN_STATUSES, RUN_STATUS_LABEL, RUN_STATUS_TONE, runStatusOf, type RunStatus } from './runStatus'
import { PageHeader } from '@/components/ui/PageHeader'
import { EmptyState, ErrorState } from '@/components/ui/empty-state'
import { QuarantinedBadge } from '@/components/ui/QuarantinedBadge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogFooter } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { useToast } from '@/lib/toast'
import { FormError } from '@/components/ui/form-field'

const RUN_TYPES: RunType[] = ['Regression', 'Sanity', 'Smoke']

// One definition feeds the desktop table and the phone cards (ResponsiveTable).
const RUN_COLUMN_DEFS: TableColumnDef[] = [
  { key: 'name', label: 'Name', alwaysVisible: true },
  { key: 'status', label: 'Status', alwaysVisible: true },
  { key: 'type', label: 'Type' },
  { key: 'cases', label: 'Cases' },
  { key: 'created', label: 'Created' },
]

const RUN_COLUMNS: ResponsiveColumn<TestRunSummary>[] = [
  {
    key: 'name',
    header: 'Name',
    card: 'title',
    cell: (run) => (
      <Link to={`/test-runs/${run.id}`} className="font-medium underline-offset-2 hover:underline">
        {run.name}
      </Link>
    ),
    cardCell: (run) => (
      <Link to={`/test-runs/${run.id}`} className={CARD_LINK_CLASS}>
        {run.name}
      </Link>
    ),
  },
  {
    key: 'status',
    header: 'Status',
    card: 'badge',
    cell: (run) => (
      <StatusBadge tone={RUN_STATUS_TONE[runStatusOf(run)]}>{RUN_STATUS_LABEL[runStatusOf(run)]}</StatusBadge>
    ),
  },
  { key: 'type', header: 'Type', cell: (run) => run.run_type },
  { key: 'cases', header: 'Cases', cell: (run) => run.case_count },
  { key: 'created', header: 'Created', cell: (run) => new Date(run.created_at).toLocaleDateString() },
]

const RUN_DETAIL: RowDetailConfig<TestRunSummary> = {
  entity: 'test run',
  title: (run) => run.name,
  badges: (run) => (
    <StatusBadge tone={RUN_STATUS_TONE[runStatusOf(run)]}>{RUN_STATUS_LABEL[runStatusOf(run)]}</StatusBadge>
  ),
  fields: (run) => [
    { label: 'ID', value: <span className="font-mono text-xs">{run.id.slice(0, 8)}</span> },
    { label: 'Type', value: run.run_type },
    { label: 'Cases', value: run.case_count },
    { label: 'Created', value: new Date(run.created_at).toLocaleDateString() },
    { label: 'Finished', value: run.finished_at ? new Date(run.finished_at).toLocaleDateString() : '—' },
  ],
  href: (run) => `/test-runs/${run.id}`,
}

export function TestRunsList() {
  const { projectId } = useParams<{ projectId: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [createOpen, setCreateOpen] = useState(false)
  const [searchParams, setSearchParams] = useSearchParams()

  // The top bar's "+ New" menu (lib/quickCreate.ts) links here with ?action=create.
  useEffect(() => {
    if (searchParams.get('action') === 'create') {
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
  }, [searchParams, setSearchParams])
  const [name, setName] = useState('')
  const { user } = useAuth()
  // ADR-106: remember the last chosen run type per user.
  const typeKey = `qth:last-run-type:${user?.user_id ?? 'anon'}`
  const [runType, setRunType] = useState<RunType>(() => {
    try {
      const saved = localStorage.getItem(typeKey)
      return (RUN_TYPES as readonly string[]).includes(saved ?? '') ? (saved as RunType) : 'Regression'
    } catch {
      return 'Regression'
    }
  })
  const [startAfter, setStartAfter] = useState(false)
  // This project's runs are loaded in full, so the tabs, search and type filter work on that list.
  const [statusTab, setStatusTab] = useState<RunStatus | ''>('')
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState<RunType | ''>('')
  const [detailRow, setDetailRow] = useState<TestRunSummary | null>(null)
  const canExecute = hasPermission(user, 'executionstep.record')
  const [selectedCaseIds, setSelectedCaseIds] = useState<string[]>([])
  const [skipQuarantined, setSkipQuarantined] = useState(false)
  const { show: showToast } = useToast()

  const projectQuery = useQuery({
    queryKey: ['projects', projectId],
    queryFn: () => getProject(projectId!),
    enabled: !!projectId,
  })
  const runsQuery = useQuery({
    queryKey: ['test-runs', projectId],
    queryFn: () => listTestRuns(projectId!),
    enabled: !!projectId,
  })
  const testCasesQuery = useQuery({
    queryKey: ['test-cases', projectId, 'all-for-run-picker'],
    queryFn: () => listTestCases(projectId!, { page_size: 100, sort: 'title' }),
    enabled: !!projectId && createOpen,
  })
  const approvedCases = (testCasesQuery.data?.items ?? []).filter((tc) => tc.status === 'approved')
  const quarantinedCount = approvedCases.filter((tc) => tc.quarantined).length

  const createMutation = useMutation({
    mutationFn: (req: TestRunCreateRequest) => createTestRun(projectId!, req),
    onSuccess: (run) => {
      queryClient.invalidateQueries({ queryKey: ['test-runs', projectId] })
      const first = run.cases[0]
      // "Create and start": straight into the Execution Console on the first case.
      navigate(startAfter && first ? `/test-run-cases/${first.id}?runId=${run.id}` : `/test-runs/${run.id}`)
      showToast('success', 'Test run created')
    },
    // No onError toast -- `createError` below already renders this inline.
  })

  function toggleCase(id: string) {
    setSelectedCaseIds((prev) => (prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id]))
  }

  function submitCreate(start: boolean) {
    setStartAfter(start)
    try {
      localStorage.setItem(typeKey, runType)
    } catch {
      /* private mode: the default is fine */
    }
    createMutation.mutate({
      name,
      run_type: runType,
      test_case_ids: selectedCaseIds,
      exclude_quarantined: skipQuarantined && quarantinedCount > 0,
    })
  }

  const columnPrefs = useColumnPrefs('test-runs-list', RUN_COLUMN_DEFS)
  const allRuns = useMemo(() => runsQuery.data ?? [], [runsQuery.data])
  const matching = useMemo(
    () =>
      allRuns.filter(
        (r) =>
          (!typeFilter || r.run_type === typeFilter) &&
          (!search.trim() || r.name.toLowerCase().includes(search.trim().toLowerCase())),
      ),
    [allRuns, typeFilter, search],
  )
  const statusCounts = Object.fromEntries(
    RUN_STATUSES.map((s) => [s, matching.filter((r) => runStatusOf(r) === s).length]),
  )
  const statusTabs = buildStatusTabs({
    order: RUN_STATUSES,
    counts: statusCounts,
    total: matching.length,
    ready: runsQuery.isSuccess,
    labels: RUN_STATUS_LABEL,
  })
  const rows = statusTab ? matching.filter((r) => runStatusOf(r) === statusTab) : matching
  const chips = typeFilter ? [{ key: 'type', label: 'Type', value: typeFilter }] : []
  const createError = createMutation.error instanceof ApiError ? createMutation.error.message : null

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
        title="Test Runs"
        actions={<Button onClick={() => setCreateOpen(true)}>New Test Run</Button>}
      />

      <FilterTabs
        label="Test run status"
        items={statusTabs}
        value={statusTab}
        onChange={(key) => setStatusTab(key as RunStatus | '')}
        panelId="project-runs-panel"
      />

      <ListToolbar
        search={{ id: 'project-runs-search', value: search, onChange: setSearch, placeholder: 'Search runs by name…' }}
        activeCount={chips.length}
        onClearFilters={() => setTypeFilter('')}
        chips={chips}
        onRemoveChip={() => setTypeFilter('')}
        columns={
          <ColumnVisibilityMenu
            columns={RUN_COLUMN_DEFS}
            isVisible={columnPrefs.isVisible}
            toggleVisible={columnPrefs.toggleVisible}
            showAll={columnPrefs.showAll}
            density={columnPrefs.density}
            setDensity={columnPrefs.setDensity}
          />
        }
        filters={
          <ListFilterField label="Type">
            <Select
              id="project-runs-type"
              aria-label="Type"
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value as RunType | '')}
            >
              <option value="">All types</option>
              {RUN_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </Select>
          </ListFilterField>
        }
      />

      <div
        id="project-runs-panel"
        role="tabpanel"
        aria-labelledby={filterTabId('project-runs-panel', statusTab)}
        className="flex flex-col gap-4"
      >
      <ResponsiveTable
        label="Test runs"
        prefs={columnPrefs}
        rows={rows}
        rowKey={(run) => run.id}
        columns={RUN_COLUMNS}
        rowProps={(run) => rowDetailProps(() => setDetailRow(run))}
        loading={runsQuery.isLoading}
        state={
          runsQuery.isError ? (
            <ErrorState error={runsQuery.error} onRetry={() => runsQuery.refetch()} />
          ) : runsQuery.data?.length === 0 ? (
            <EmptyState
              title="No test runs yet"
              description="A test run executes a set of approved test cases and records the results."
              action={
                hasPermission(user, 'testrun.create') ? (
                  <Button size="sm" onClick={() => setCreateOpen(true)}>
                    Create your first test run
                  </Button>
                ) : undefined
              }
            />
          ) : runsQuery.data && rows.length === 0 ? (
            <EmptyState
              variant="filtered"
              title="No test runs match these filters"
              description="Try clearing a filter to see more runs."
              action={
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setSearch('')
                    setTypeFilter('')
                    setStatusTab('')
                  }}
                >
                  Clear filters
                </Button>
              }
            />
          ) : undefined
        }
        stateCellClassName="px-4"
      />
      {rows.length > 0 && (
        <p aria-live="polite" className="text-xs text-[var(--muted-foreground)]">
          Showing 1-{rows.length} of {rows.length} run{rows.length === 1 ? '' : 's'}
        </p>
      )}
      </div>
      <RowDetailDrawer row={detailRow} onClose={() => setDetailRow(null)} config={RUN_DETAIL} />

      <Dialog open={createOpen} onClose={() => setCreateOpen(false)} title="New Test Run" className="max-w-xl">
        <div className="flex flex-col gap-3 text-sm">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="run-name">Name</Label>
            <Input id="run-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="run-type">Type</Label>
            <Select id="run-type" value={runType} onChange={(e) => setRunType(e.target.value as RunType)}>
              {RUN_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Approved Test Cases</Label>
            {approvedCases.length === 0 && (
              <p className="text-xs text-[var(--muted-foreground)]">
                No approved test cases in this project yet — only approved cases can be bundled into a run.
              </p>
            )}
            <ul className="flex max-h-48 flex-col gap-1 overflow-y-auto rounded-md border border-[var(--border)] p-2 max-md:max-h-[40svh]">
              {approvedCases.map((tc) => (
                <li key={tc.id}>
                  <label className="flex items-center gap-2 max-md:min-h-11">
                    <input
                      type="checkbox"
                      checked={selectedCaseIds.includes(tc.id)}
                      onChange={() => toggleCase(tc.id)}
                    />
                    {tc.title}
                    {tc.quarantined && <QuarantinedBadge title={tc.quarantine_reason} />}
                  </label>
                </li>
              ))}
            </ul>
          </div>
          {quarantinedCount > 0 && (
            <label className="flex items-center gap-2 text-sm max-md:min-h-11">
              <input
                type="checkbox"
                checked={skipQuarantined}
                onChange={(e) => setSkipQuarantined(e.target.checked)}
              />
              Skip quarantined cases ({quarantinedCount})
            </label>
          )}
          <FormError>{createError}</FormError>
          <DialogFooter>
            {canExecute && (
              <Button
                disabled={!name || selectedCaseIds.length === 0}
                loading={createMutation.isPending && startAfter}
                onClick={() => submitCreate(true)}
              >
                Create and start
              </Button>
            )}
            <Button
              variant={canExecute ? 'outline' : 'default'}
              disabled={!name || selectedCaseIds.length === 0 || createMutation.isPending}
              onClick={() => submitCreate(false)}
            >
              {createMutation.isPending && !startAfter ? 'Creating…' : 'Create Test Run'}
            </Button>
          </DialogFooter>
        </div>
      </Dialog>
    </div>
  )
}
