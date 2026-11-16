import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useParams } from 'react-router-dom'

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
import { CARD_LINK_CLASS, ResponsiveTable, type ResponsiveColumn } from '@/components/table/ResponsiveTable'
import { Badge } from '@/components/ui/badge'
import { PageHeader } from '@/components/ui/PageHeader'
import { Button } from '@/components/ui/button'
import { Dialog, DialogFooter } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { useToast } from '@/lib/toast'
import { FormError } from '@/components/ui/form-field'

const RUN_TYPES: RunType[] = ['Regression', 'Sanity', 'Smoke']

// One definition feeds the desktop table and the phone cards (ResponsiveTable).
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
      <Badge tone={run.finished_at ? 'neutral' : 'positive'}>{run.finished_at ? 'Finished' : 'Active'}</Badge>
    ),
  },
  { key: 'type', header: 'Type', cell: (run) => run.run_type },
  { key: 'cases', header: 'Cases', cell: (run) => run.case_count },
  { key: 'created', header: 'Created', cell: (run) => new Date(run.created_at).toLocaleDateString() },
]

export function TestRunsList() {
  const { projectId } = useParams<{ projectId: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [createOpen, setCreateOpen] = useState(false)
  const [name, setName] = useState('')
  const [runType, setRunType] = useState<RunType>('Regression')
  const [selectedCaseIds, setSelectedCaseIds] = useState<string[]>([])
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

  const createMutation = useMutation({
    mutationFn: (req: TestRunCreateRequest) => createTestRun(projectId!, req),
    onSuccess: (run) => {
      queryClient.invalidateQueries({ queryKey: ['test-runs', projectId] })
      navigate(`/test-runs/${run.id}`)
      showToast('success', 'Test run created')
    },
    // No onError toast -- `createError` below already renders this inline.
  })

  function toggleCase(id: string) {
    setSelectedCaseIds((prev) => (prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id]))
  }

  function submitCreate() {
    createMutation.mutate({ name, run_type: runType, test_case_ids: selectedCaseIds })
  }

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

      <ResponsiveTable
        label="Test runs"
        rows={runsQuery.data ?? []}
        rowKey={(run) => run.id}
        columns={RUN_COLUMNS}
        loading={runsQuery.isLoading}
        state={
          runsQuery.data?.length === 0 ? (
            <p className="py-6 text-center text-sm text-[var(--muted-foreground)]">No test runs yet.</p>
          ) : undefined
        }
        stateCellClassName="px-4"
      />

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
                  </label>
                </li>
              ))}
            </ul>
          </div>
          <FormError>{createError}</FormError>
          <DialogFooter>
            <Button
              disabled={!name || selectedCaseIds.length === 0 || createMutation.isPending}
              onClick={submitCreate}
            >
              {createMutation.isPending ? 'Creating…' : 'Create Test Run'}
            </Button>
          </DialogFooter>
        </div>
      </Dialog>
    </div>
  )
}
