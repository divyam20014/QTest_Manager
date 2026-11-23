import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useParams } from 'react-router-dom'

import { ApiError } from '@/api/client'
import { listDefects } from '@/api/defects'
import { DefectStatusBadge } from '@/routes/defects/DefectStatusBadge'
import {
  addTestRunCases,
  assignRunCase,
  deleteTestRun,
  finishTestRun,
  reopenTestRun,
  getTestRun,
  pauseTestRun,
  removeTestRunCase,
  rerunFailedTestRun,
  resumeTestRun,
  updateTestRun,
  type RunType,
  type TestRun,
} from '@/api/execution'
import { listTestCases } from '@/api/testCases'
import { listUsers } from '@/api/users'
import { CARD_LINK_CLASS, ResponsiveTable, type ResponsiveColumn } from '@/components/table/ResponsiveTable'
import { Badge } from '@/components/ui/badge'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { RecordPin } from '@/components/RecordPin'
import { PageHeader } from '@/components/ui/PageHeader'
import { humanizeKey } from '@/lib/labels'
import { RUN_CASE_STATUS_TONE } from '@/lib/statusTones'
import { DetailSkeleton } from '@/components/ui/skeleton'
import { EmptyState, ErrorState } from '@/components/ui/empty-state'
import { Button } from '@/components/ui/button'
import { useConfirm } from '@/components/ui/useConfirm'
import { Dialog, DialogFooter } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { useAuth } from '@/lib/auth'
import { hasPermission, isManagerOrAbove } from '@/api/auth'
import { useToast } from '@/lib/toast'
import { useCanListUsers } from '@/lib/useCanListUsers'
import { FormError } from '@/components/ui/form-field'


const RUN_TYPES: RunType[] = ['Regression', 'Sanity', 'Smoke']

// A run finishes by itself only when every case is blocked, or has every step
// recorded and no failure (ADR-070). A failed case keeps the run open on purpose so
// the failed step can be re-run after the fix. When nothing else is left to do, tell
// the user why the run is still active: returns how many failed cases are holding it open.
function failedCasesHoldingRunOpen(run: TestRun): number {
  if (run.cases.length === 0) return 0
  const hasUnrecordedSteps = run.cases.some(
    (c) => c.status !== 'blocked' && c.passed_count + c.failed_count + c.ignored_count < c.step_count,
  )
  if (hasUnrecordedSteps) return 0
  return run.cases.filter((c) => c.status === 'failed').length
}

export function TestRunDetail() {
  const { runId } = useParams<{ runId: string }>()
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const [editOpen, setEditOpen] = useState(false)
  const [addCasesOpen, setAddCasesOpen] = useState(false)
  const { show: showToast } = useToast()
  const { ask, dialog: confirmDialog } = useConfirm()
  const navigate = useNavigate()

  const runQuery = useQuery({ queryKey: ['test-runs', 'detail', runId], queryFn: () => getTestRun(runId!), enabled: !!runId })
  const canListUsers = useCanListUsers()
  const usersQuery = useQuery({ queryKey: ['users'], queryFn: listUsers, enabled: canListUsers })

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

  // ADR-075: undo a finish. Only clears the finish time; results are untouched and
  // the run does not finish again until the next verdict or block.
  const reopenMutation = useMutation({
    mutationFn: () => reopenTestRun(runId!),
    onSuccess: () => {
      invalidate()
      showToast('success', 'Test run reopened')
    },
  })

  // ADR-096: a new run with only the failed and blocked cases. Errors (an access-rule
  // block, nothing to rerun) are shown inline with their reason, not as a generic retry.
  const rerunMutation = useMutation({
    mutationFn: () => rerunFailedTestRun(runId!),
    onSuccess: (created) => {
      queryClient.invalidateQueries({ queryKey: ['test-runs'] })
      showToast('success', 'Rerun created with the failed and blocked cases')
      navigate(`/test-runs/${created.id}`)
    },
  })

  // ADR-070: soft delete -- the run leaves every list and report; its data is retained.
  const deleteMutation = useMutation({
    mutationFn: () => deleteTestRun(runId!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['test-runs'] })
      queryClient.invalidateQueries({ queryKey: ['dashboard'] })
      showToast('success', 'Test run deleted')
      navigate(`/projects/${runQuery.data?.project_id}/test-runs`, { replace: true })
    },
    onError: () => showToast('error', 'Could not delete this test run'),
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
  if (runQuery.isLoading) return <DetailSkeleton />
  if (runQuery.isError) return <ErrorState message="Could not load this test run." error={runQuery.error} onRetry={() => runQuery.refetch()} />
  if (!run) return <EmptyState title="Test run not found" description="It may have been deleted, or you may not have access to it." />

  const canManage = isManagerOrAbove(user)
  const canFinish = canManage && !run.finished_at
  const heldOpenBy = !run.finished_at && !run.paused_at ? failedCasesHoldingRunOpen(run) : 0
  const canDelete = hasPermission(user, 'testrun.delete')
  const executionStarted = run.cases.some((rc) => rc.started_at !== null)
  const canEdit = canManage && !run.finished_at && !executionStarted
  const finishError = finishMutation.error instanceof ApiError ? finishMutation.error.message : null
  const rerunError = rerunMutation.error instanceof ApiError ? rerunMutation.error.message : null
  const canRerun =
    hasPermission(user, 'testrun.create') &&
    run.cases.some((rc) => rc.status === 'failed' || rc.status === 'blocked')
  const usersById = new Map((usersQuery.data ?? []).map((u) => [u.id, u.name]))

  const caseColumns: ResponsiveColumn<(typeof run.cases)[number]>[] = [
    {
      key: 'title',
      header: 'Test Case',
      card: 'title',
      tdClassName: 'font-medium',
      cell: (rc) => rc.title,
      cardCell: (rc) => (
        <Link to={`/test-run-cases/${rc.id}?runId=${run.id}`} className={CARD_LINK_CLASS}>
          {rc.title}
        </Link>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      card: 'badge',
      cell: (rc) => (
        <div className="flex flex-col items-start gap-1">
          <StatusBadge tone={RUN_CASE_STATUS_TONE[rc.status]}>{humanizeKey(rc.status)}</StatusBadge>
          {rc.status === 'blocked' && rc.blocked_reason && (
            <span className="max-w-xs break-words text-xs text-[var(--muted-foreground)]">{rc.blocked_reason}</span>
          )}
        </div>
      ),
    },
    {
      key: 'progress',
      header: 'Progress',
      tdClassName: 'text-xs text-[var(--muted-foreground)]',
      cell: (rc) => `${rc.passed_count + rc.failed_count + rc.ignored_count}/${rc.step_count} steps`,
    },
    {
      key: 'assignee',
      header: 'Assignee',
      cell: (rc) =>
        canManage && !run.finished_at ? (
          <Select
            aria-label={`Assignee for ${rc.title}`}
            value={rc.assigned_to ?? ''}
            onChange={(e) => assignMutation.mutate({ runCaseId: rc.id, userId: e.target.value || null })}
            className="w-36 max-md:w-full"
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
        ),
    },
  ]

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        back={
          <Link
            to={`/projects/${run.project_id}/test-runs`}
            className="inline-flex text-xs text-[var(--muted-foreground)] hover:underline max-md:min-h-11 max-md:items-center max-md:text-sm"
          >
            ← Test Runs
          </Link>
        }
        title={run.name}
        meta={
          <>
            <RecordPin type="test_run" id={run.id} title={run.name} url={`/test-runs/${run.id}`} />
            <Badge tone="neutral">{run.run_type}</Badge>
            <Badge tone={run.finished_at ? 'neutral' : 'positive'}>{run.finished_at ? 'Finished' : 'Active'}</Badge>
            {run.paused_at && <Badge tone="warning">Paused</Badge>}
          </>
        }
        actionsClassName="max-md:[&>button]:flex-1"
        actions={
          <>
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
          {canRerun && (
            <Button variant="outline" onClick={() => rerunMutation.mutate()} disabled={rerunMutation.isPending}>
              {rerunMutation.isPending ? 'Creating rerun…' : 'Rerun failed'}
            </Button>
          )}
          {canManage && run.finished_at && (
            <Button
              variant="outline"
              onClick={() =>
                ask({
                  title: 'Reopen this run?',
                  description:
                    'The run becomes active again so testers can unblock cases and record results. Nothing already recorded is changed, and the run finishes again once every case is complete or you finish it by hand.',
                  confirmLabel: 'Reopen run',
                  destructive: false,
                  run: () => reopenMutation.mutateAsync(),
                })
              }
              disabled={reopenMutation.isPending}
            >
              Reopen Run
            </Button>
          )}
          {canFinish && (
            <Button
              onClick={() =>
                ask({
                  title: 'Finish this run?',
                  description:
                    'A finished run is locked: results can no longer be recorded, cases cannot be added or removed, and it counts towards reports as complete. Cases that are still pending stay pending.',
                  confirmLabel: 'Finish run',
                  destructive: false,
                  run: () => finishMutation.mutateAsync(),
                })
              }
              disabled={finishMutation.isPending}
            >
              Finish Run
            </Button>
          )}
          {canDelete && (
            <Button
              variant="outline"
              onClick={() =>
                ask({
                  title: `Delete test run "${run.name}"?`,
                  description:
                    'The run disappears from the test runs list, dashboards and reports. Its results and defects are kept in the system but you will not be able to open it again from here.',
                  confirmLabel: 'Delete run',
                  run: () => deleteMutation.mutateAsync(),
                })
              }
              disabled={deleteMutation.isPending}
            >
              Delete Run
            </Button>
          )}
          </>
        }
      />
      {confirmDialog}
      {heldOpenBy > 0 && (
        <div
          role="status"
          className="rounded-md border border-[var(--border)] bg-[var(--tactile-surface-raised)] px-4 py-3 text-sm"
        >
          <p className="font-medium">
            Every case has results, but {heldOpenBy} {heldOpenBy === 1 ? 'case' : 'cases'} failed.
          </p>
          <p className="text-[var(--muted-foreground)]">
            The run stays open so failed steps can be re-run after a fix and passed.
            {canManage ? ' Use Finish Run when you are done.' : ' A manager or admin finishes it when you are done.'}
          </p>
        </div>
      )}
      <FormError>{finishError}</FormError>
      <FormError>{rerunError}</FormError>

      <ResponsiveTable
        label="Test cases in this run"
        rows={run.cases}
        rowKey={(rc) => rc.id}
        columns={caseColumns}
        rowActions={(rc) => (
          <div className="flex items-center justify-end gap-3">
            {canManage && !run.finished_at && !rc.started_at && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  ask({
                    title: 'Remove this test case from the run?',
                    description: `“${rc.title}” is taken out of this run. The test case itself stays in the repository, and you can add it back while the run is open.`,
                    confirmLabel: 'Remove from run',
                    run: () => removeMutation.mutateAsync(rc.id),
                  })
                }
                disabled={removeMutation.isPending}
              >
                Remove
              </Button>
            )}
            <Link
              to={`/test-run-cases/${rc.id}?runId=${run.id}`}
              className="text-sm underline-offset-2 hover:underline max-md:inline-flex max-md:min-h-11 max-md:flex-1 max-md:items-center max-md:justify-center max-md:rounded-md max-md:border max-md:border-[var(--border)] max-md:font-medium max-md:no-underline"
            >
              {run.finished_at ? 'View' : 'Execute'}
            </Link>
          </div>
        )}
      />

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
        <FormError>{serverError}</FormError>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" disabled={updateMutation.isPending} onClick={() => updateMutation.mutate()}>
            {updateMutation.isPending ? 'Saving…' : 'Save Changes'}
          </Button>
        </DialogFooter>
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
        <ul className="flex max-h-56 flex-col gap-1 overflow-y-auto rounded-md border border-[var(--border)] p-2 max-md:max-h-[50svh]">
          {addableCases.map((tc) => (
            <li key={tc.id}>
              <label className="flex items-center gap-2 max-md:min-h-11">
                <input type="checkbox" checked={selectedIds.includes(tc.id)} onChange={() => toggle(tc.id)} />
                {tc.title}
              </label>
            </li>
          ))}
        </ul>
        <FormError>{serverError}</FormError>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" disabled={selectedIds.length === 0 || addMutation.isPending} onClick={() => addMutation.mutate()}>
            {addMutation.isPending ? 'Adding…' : 'Add Selected'}
          </Button>
        </DialogFooter>
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
            <li key={d.id} className="flex items-center justify-between gap-3 px-4 py-2 max-md:min-h-11">
              <Link
                to={`/defects/${d.id}`}
                className="min-w-0 break-words underline-offset-2 hover:underline max-md:inline-flex max-md:min-h-11 max-md:items-center"
              >
                {d.title}
              </Link>
              <DefectStatusBadge status={d.status} label={d.status_label} />
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
