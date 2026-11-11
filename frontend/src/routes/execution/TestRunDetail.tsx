import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useParams } from 'react-router-dom'

import { ApiError } from '@/api/client'
import { listDefects } from '@/api/defects'
import { STATUS_TONE } from '@/routes/defects/statusDisplay'
import {
  addTestRunCases,
  assignRunCase,
  finishTestRun,
  getTestRun,
  pauseTestRun,
  removeTestRunCase,
  resumeTestRun,
  updateTestRun,
  type RunType,
} from '@/api/execution'
import { listTestCases } from '@/api/testCases'
import { listUsers } from '@/api/users'
import { Badge } from '@/components/ui/badge'
import { humanizeKey } from '@/lib/labels'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { useAuth } from '@/lib/auth'
import { isManagerOrAbove } from '@/api/auth'
import { useToast } from '@/lib/toast'

const CASE_STATUS_TONE = {
  pending: 'neutral',
  in_progress: 'warning',
  passed: 'positive',
  failed: 'critical',
  blocked: 'critical',
  ignored: 'neutral',
} as const

const RUN_TYPES: RunType[] = ['Regression', 'Sanity', 'Smoke']

export function TestRunDetail() {
  const { runId } = useParams<{ runId: string }>()
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const [editOpen, setEditOpen] = useState(false)
  const [addCasesOpen, setAddCasesOpen] = useState(false)
  const { show: showToast } = useToast()

  const runQuery = useQuery({ queryKey: ['test-runs', 'detail', runId], queryFn: () => getTestRun(runId!), enabled: !!runId })
  const usersQuery = useQuery({ queryKey: ['users'], queryFn: listUsers })

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ['test-runs', 'detail', runId] })
    queryClient.invalidateQueries({ queryKey: ['test-runs'] })
  }

  const finishMutation = useMutation({
    mutationFn: () => finishTestRun(runId!),
    onSuccess: () => {
      invalidate()
      showToast('success', 'Test run finished')
    },
    // No onError toast -- `finishError` below already renders this inline.
  })

  const pauseMutation = useMutation({
    mutationFn: () => pauseTestRun(runId!),
    onSuccess: () => {
      invalidate()
      showToast('success', 'Run paused')
    },
    onError: () => showToast('error', 'Failed to pause the run'),
  })
  const resumeMutation = useMutation({
    mutationFn: () => resumeTestRun(runId!),
    onSuccess: () => {
      invalidate()
      showToast('success', 'Run resumed')
    },
    onError: () => showToast('error', 'Failed to resume the run'),
  })

  const removeMutation = useMutation({
    mutationFn: (runCaseId: string) => removeTestRunCase(runId!, runCaseId),
    onSuccess: () => {
      invalidate()
      showToast('success', 'Test case removed from run')
    },
    onError: () => showToast('error', 'Could not remove this test case from the run'),
  })

  const assignMutation = useMutation({
    mutationFn: ({ runCaseId, userId }: { runCaseId: string; userId: string | null }) =>
      assignRunCase(runCaseId, userId),
    onSuccess: () => {
      invalidate()
      showToast('success', 'Assignee updated')
    },
    onError: () => showToast('error', 'Could not update the assignee'),
  })

  const run = runQuery.data
  if (runQuery.isLoading) return <p className="text-sm text-[var(--muted-foreground)]">Loading…</p>
  if (runQuery.isError || !run) return <p className="text-sm text-[var(--destructive)]">Test run not found.</p>

  const canManage = isManagerOrAbove(user)
  const canFinish = canManage && !run.finished_at
  const executionStarted = run.cases.some((rc) => rc.started_at !== null)
  const canEdit = canManage && !run.finished_at && !executionStarted
  const finishError = finishMutation.error instanceof ApiError ? finishMutation.error.message : null
  const usersById = new Map((usersQuery.data ?? []).map((u) => [u.id, u.name]))

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <Link to={`/projects/${run.project_id}/test-runs`} className="text-xs text-[var(--muted-foreground)] hover:underline">
            ← Test Runs
          </Link>
          <div className="flex items-center gap-3">
            <h1 className="text-lg font-semibold">{run.name}</h1>
            <Badge tone="neutral">{run.run_type}</Badge>
            <Badge tone={run.finished_at ? 'neutral' : 'positive'}>{run.finished_at ? 'Finished' : 'Active'}</Badge>
            {run.paused_at && <Badge tone="warning">Paused</Badge>}
          </div>
        </div>
        <div className="flex gap-2">
          {canEdit && (
            <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
              Edit Run
            </Button>
          )}
          {canManage && !run.finished_at && (
            <Button variant="outline" size="sm" onClick={() => setAddCasesOpen(true)}>
              Add Test Cases
            </Button>
          )}
          {canManage && !run.finished_at && !run.paused_at && (
            <Button variant="outline" size="sm" onClick={() => pauseMutation.mutate()} disabled={pauseMutation.isPending}>
              Pause Run
            </Button>
          )}
          {canManage && !run.finished_at && run.paused_at && (
            <Button variant="outline" size="sm" onClick={() => resumeMutation.mutate()} disabled={resumeMutation.isPending}>
              Resume Run
            </Button>
          )}
          {canFinish && (
            <Button onClick={() => finishMutation.mutate()} disabled={finishMutation.isPending}>
              Finish Run
            </Button>
          )}
        </div>
      </div>
      {finishError && <p className="text-xs text-[var(--destructive)]">{finishError}</p>}

      <div className="overflow-x-auto rounded-lg border border-[var(--border)]">
        <table className="w-full text-sm">
          <thead className="bg-[var(--muted)] text-left text-xs text-[var(--muted-foreground)]">
            <tr>
              <th className="px-4 py-2 font-medium">Test Case</th>
              <th className="px-4 py-2 font-medium">Status</th>
              <th className="px-4 py-2 font-medium">Progress</th>
              <th className="px-4 py-2 font-medium">Assignee</th>
              <th className="px-4 py-2 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {run.cases.map((rc) => (
              <tr key={rc.id} className="border-t border-[var(--border)] hover:bg-[var(--muted)]">
                <td className="px-4 py-2 font-medium">{rc.title}</td>
                <td className="px-4 py-2">
                  <Badge tone={CASE_STATUS_TONE[rc.status]}>{humanizeKey(rc.status)}</Badge>
                </td>
                <td className="px-4 py-2 text-xs text-[var(--muted-foreground)]">
                  {rc.passed_count + rc.failed_count + rc.ignored_count}/{rc.step_count} steps
                </td>
                <td className="px-4 py-2">
                  {canManage && !run.finished_at ? (
                    <Select
                      aria-label={`Assignee for ${rc.title}`}
                      value={rc.assigned_to ?? ''}
                      onChange={(e) =>
                        assignMutation.mutate({ runCaseId: rc.id, userId: e.target.value || null })
                      }
                      className="w-36"
                    >
                      <option value="">Unassigned</option>
                      {(usersQuery.data ?? []).map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.name}
                        </option>
                      ))}
                    </Select>
                  ) : (
                    (rc.assigned_to && usersById.get(rc.assigned_to)) || '—'
                  )}
                </td>
                <td className="px-4 py-2 text-right">
                  <div className="flex items-center justify-end gap-3">
                    {canManage && !run.finished_at && !rc.started_at && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => removeMutation.mutate(rc.id)}
                        disabled={removeMutation.isPending}
                      >
                        Remove
                      </Button>
                    )}
                    <Link
                      to={`/test-run-cases/${rc.id}?runId=${run.id}`}
                      className="text-sm underline-offset-2 hover:underline"
                    >
                      {run.finished_at ? 'View' : 'Execute'}
                    </Link>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <LinkedDefectsCard runId={run.id} />

      <EditRunDialog open={editOpen} onClose={() => setEditOpen(false)} runId={run.id} name={run.name} runType={run.run_type} />
      <AddCasesDialog
        open={addCasesOpen}
        onClose={() => setAddCasesOpen(false)}
        runId={run.id}
        projectId={run.project_id}
        existingCaseIds={new Set(run.cases.map((rc) => rc.test_case_id))}
      />
    </div>
  )
}

function EditRunDialog({
  open,
  onClose,
  runId,
  name: initialName,
  runType: initialRunType,
}: {
  open: boolean
  onClose: () => void
  runId: string
  name: string
  runType: RunType
}) {
  const queryClient = useQueryClient()
  const [name, setName] = useState(initialName)
  const [runType, setRunType] = useState<RunType>(initialRunType)
  const { show: showToast } = useToast()

  const updateMutation = useMutation({
    mutationFn: () => updateTestRun(runId, { name, run_type: runType }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['test-runs', 'detail', runId] })
      onClose()
      showToast('success', 'Run details updated')
    },
    // No onError toast -- `serverError` below already renders this inline.
  })

  const serverError = updateMutation.error instanceof ApiError ? updateMutation.error.message : null

  return (
    <Dialog open={open} onClose={onClose} title="Edit Run">
      <div className="flex flex-col gap-3 text-sm">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="run-name">Name</Label>
          <Input id="run-name" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="run-type">Run Type</Label>
          <Select id="run-type" value={runType} onChange={(e) => setRunType(e.target.value as RunType)}>
            {RUN_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </Select>
        </div>
        {serverError && <p className="text-xs text-[var(--destructive)]">{serverError}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" disabled={updateMutation.isPending} onClick={() => updateMutation.mutate()}>
            {updateMutation.isPending ? 'Saving…' : 'Save Changes'}
          </Button>
        </div>
      </div>
    </Dialog>
  )
}

function AddCasesDialog({
  open,
  onClose,
  runId,
  projectId,
  existingCaseIds,
}: {
  open: boolean
  onClose: () => void
  runId: string
  projectId: string
  existingCaseIds: Set<string>
}) {
  const queryClient = useQueryClient()
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const { show: showToast } = useToast()

  const casesQuery = useQuery({
    queryKey: ['test-cases', projectId, 'approved-for-run'],
    queryFn: () => listTestCases(projectId, { status: 'approved', page_size: 100 }),
    enabled: open,
  })
  const addableCases = (casesQuery.data?.items ?? []).filter((tc) => !existingCaseIds.has(tc.id))

  const addMutation = useMutation({
    mutationFn: () => addTestRunCases(runId, selectedIds),
    onSuccess: (_data, _vars) => {
      queryClient.invalidateQueries({ queryKey: ['test-runs', 'detail', runId] })
      const count = selectedIds.length
      setSelectedIds([])
      onClose()
      showToast('success', `${count} test case${count === 1 ? '' : 's'} added to run`)
    },
    // No onError toast -- `serverError` below already renders this inline.
  })

  function toggle(id: string) {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id]))
  }

  const serverError = addMutation.error instanceof ApiError ? addMutation.error.message : null

  return (
    <Dialog open={open} onClose={onClose} title="Add Test Cases">
      <div className="flex flex-col gap-3 text-sm">
        {addableCases.length === 0 && (
          <p className="text-xs text-[var(--muted-foreground)]">
            No more approved test cases are available to add to this run.
          </p>
        )}
        <ul className="flex max-h-56 flex-col gap-1 overflow-y-auto rounded-md border border-[var(--border)] p-2">
          {addableCases.map((tc) => (
            <li key={tc.id}>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={selectedIds.includes(tc.id)} onChange={() => toggle(tc.id)} />
                {tc.title}
              </label>
            </li>
          ))}
        </ul>
        {serverError && <p className="text-xs text-[var(--destructive)]">{serverError}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" disabled={selectedIds.length === 0 || addMutation.isPending} onClick={() => addMutation.mutate()}>
            {addMutation.isPending ? 'Adding…' : 'Add Selected'}
          </Button>
        </div>
      </div>
    </Dialog>
  )
}

function LinkedDefectsCard({ runId }: { runId: string }) {
  const defectsQuery = useQuery({
    queryKey: ['defects', 'by-run-detail', runId],
    queryFn: () => listDefects({ test_run_id: runId }),
  })
  const defects = defectsQuery.data ?? []

  if (defects.length === 0) return null

  return (
    <div className="flex flex-col gap-2">
      <h2 className="text-sm font-semibold">Linked Defects ({defects.length})</h2>
      <div className="overflow-hidden rounded-lg border border-[var(--border)]">
        <ul className="divide-y divide-[var(--border)] text-sm">
          {defects.map((d) => (
            <li key={d.id} className="flex items-center justify-between px-4 py-2">
              <Link to={`/defects/${d.id}`} className="underline-offset-2 hover:underline">
                {d.title}
              </Link>
              <Badge tone={STATUS_TONE[d.status]}>{d.status}</Badge>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
