import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { ApiError } from '@/api/client'
import {
  getDefectColumns,
  startDefectRetest,
  updateDefect,
  updateDefectStatus,
  type Defect,
  type DefectStatus,
  type Resolution,
} from '@/api/defects'
import { listUsers } from '@/api/users'
import { Button } from '@/components/ui/button'
import { Dialog, DialogFooter } from '@/components/ui/dialog'
import { FormError, FormField } from '@/components/ui/form-field'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { useDefectPermissions } from '@/lib/useDefectPermissions'
import { allowedNextStatuses, planTransition, resolutionExplanation, transitionMenu } from '@/lib/defectWorkflow'
import { useToast } from '@/lib/toast'
import { useCanListUsers } from '@/lib/useCanListUsers'
import { defectPath } from '@/lib/entityRoutes'

/** What the dialogs need to know about a defect. */
export type ActionDefect = Pick<Defect, 'id' | 'status' | 'title' | 'display_id' | 'resolution' | 'assigned_to' | 'reported_by' | 'project_id'>

function useRefreshDefects() {
  const queryClient = useQueryClient()
  return () => {
    void queryClient.invalidateQueries({ queryKey: ['defects'] })
    void queryClient.invalidateQueries({ queryKey: ['dashboard'] })
    void queryClient.invalidateQueries({ queryKey: ['test-cases'] })
  }
}

/**
 * Change status: only the statuses the defect may move to are offered (closing and reopening shown
 * disabled, with the reason, for someone who may not close). Where the move needs a resolution the
 * dialog asks for it, with the rule explained; closing needs the explicit verification tick.
 */
export function StatusChangeDialog({
  defect,
  initialTarget,
  onClose,
}: {
  defect: ActionDefect | null
  /** Status to preselect (the Reopen / Close shortcuts). */
  initialTarget?: DefectStatus
  onClose: () => void
}) {
  return (
    <Dialog open={defect !== null} onClose={onClose} title="Change status" className="max-w-lg">
      {defect && <StatusChangeForm key={`${defect.id}-${defect.status}-${initialTarget ?? ''}`} defect={defect} initialTarget={initialTarget} onClose={onClose} />}
    </Dialog>
  )
}

function StatusChangeForm({ defect, initialTarget, onClose }: { defect: ActionDefect; initialTarget?: DefectStatus; onClose: () => void }) {
  const perms = useDefectPermissions()
  const refresh = useRefreshDefects()
  const { show } = useToast()
  const catalogQuery = useQuery({ queryKey: ['defects', 'columns'], queryFn: getDefectColumns, staleTime: 5 * 60_000 })
  const options = transitionMenu(defect.status, perms, catalogQuery.data)
  const usable = options.filter((o) => !o.disabledReason)
  const first = initialTarget && usable.some((o) => o.status === initialTarget) ? initialTarget : (usable[0]?.status ?? '')
  const [target, setTarget] = useState<string>(first)
  const plan = target ? planTransition(defect.status, target as DefectStatus) : null
  const [resolution, setResolution] = useState<string>(plan?.defaultResolution ?? '')
  const [comment, setComment] = useState('')
  const [verified, setVerified] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const mutation = useMutation({
    mutationFn: () =>
      updateDefectStatus(defect.id, {
        status: target as DefectStatus,
        resolution: (resolution || undefined) as Resolution | undefined,
        comment: comment.trim() || undefined,
        verification_confirmed: verified,
      }),
    onSuccess: (updated) => {
      refresh()
      show('success', `${defect.display_id ?? 'Defect'} is now ${updated.status_label ?? updated.status}`)
      onClose()
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Could not change the status. Try again.'),
  })

  function submit() {
    setError(null)
    if (!plan) return
    if (plan.needsResolution && !resolution) {
      setError(`Choose a resolution to set ${target}.`)
      return
    }
    if (plan.needsVerification && !verified) {
      setError('Confirm that the defect was verified before closing it.')
      return
    }
    mutation.mutate()
  }

  const next = allowedNextStatuses(defect.status, catalogQuery.data)

  return (
    <div className="flex flex-col gap-3 text-sm">
      <p className="text-[var(--muted-foreground)]">
        <span className="font-mono">{defect.display_id ?? ''}</span> {defect.title}
      </p>
      {options.length === 0 ? (
        <p className="rounded-md bg-[var(--muted)] px-3 py-2">You do not have permission to change the status of this defect.</p>
      ) : (
        <>
          <FormField
            id="status-target"
            label="New status"
            required
            helper={`From ${defect.status} a defect can move to: ${next.join(', ') || 'nothing'}.`}
          >
            {(f) => (
              <Select
                {...f}
                value={target}
                onChange={(e) => {
                  setTarget(e.target.value)
                  setResolution(planTransition(defect.status, e.target.value as DefectStatus).defaultResolution ?? '')
                  setError(null)
                }}
              >
                {options.map((o) => (
                  <option key={o.status} value={o.status} disabled={!!o.disabledReason}>
                    {o.disabledReason ? `${o.status} (needs close permission)` : o.status}
                  </option>
                ))}
              </Select>
            )}
          </FormField>
          {plan && plan.resolutionOptions.length > 0 && (
            <FormField id="status-resolution" label="Resolution" required={plan.needsResolution} helper={resolutionExplanation(plan.to)}>
              {(f) => (
                <Select {...f} value={resolution} onChange={(e) => setResolution(e.target.value)}>
                  <option value="">{plan.needsResolution ? 'Select a resolution…' : 'None'}</option>
                  {plan.resolutionOptions.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </Select>
              )}
            </FormField>
          )}
          {plan && plan.resolutionOptions.length === 0 && (
            <p className="text-xs text-[var(--muted-foreground)]">{resolutionExplanation(plan.to)}</p>
          )}
          <FormField id="status-comment" label="Comment (optional)">
            {(f) => <Textarea {...f} rows={2} maxLength={2000} value={comment} onChange={(e) => setComment(e.target.value)} />}
          </FormField>
          {plan?.needsVerification && (
            <label className="flex items-start gap-2">
              <input type="checkbox" className="mt-1" checked={verified} onChange={(e) => setVerified(e.target.checked)} />
              I confirm this defect has been verified and should be closed.
            </label>
          )}
        </>
      )}
      <FormError>{error}</FormError>
      <DialogFooter>
        <Button variant="outline" size="sm" onClick={onClose}>
          Cancel
        </Button>
        {options.length > 0 && (
          <Button size="sm" loading={mutation.isPending} disabled={!target} onClick={submit}>
            Change status
          </Button>
        )}
      </DialogFooter>
    </div>
  )
}

/** Assign (or unassign) a defect. A New defect can move to Assigned in the same step. */
export function AssignDialog({ defect, onClose }: { defect: ActionDefect | null; onClose: () => void }) {
  return (
    <Dialog open={defect !== null} onClose={onClose} title="Assign defect" className="max-w-md">
      {defect && <AssignForm key={defect.id} defect={defect} onClose={onClose} />}
    </Dialog>
  )
}

function AssignForm({ defect, onClose }: { defect: ActionDefect; onClose: () => void }) {
  const perms = useDefectPermissions()
  const refresh = useRefreshDefects()
  const { show } = useToast()
  const canListUsers = useCanListUsers()
  const usersQuery = useQuery({ queryKey: ['users'], queryFn: listUsers, enabled: canListUsers })
  const [assignee, setAssignee] = useState(defect.assigned_to ?? '')
  const canAlsoSetAssigned = perms.canChangeStatus && allowedNextStatuses(defect.status).includes('Assigned')
  const [alsoAssigned, setAlsoAssigned] = useState(defect.status === 'New')
  const [error, setError] = useState<string | null>(null)

  const mutation = useMutation({
    mutationFn: async () => {
      const updated = await updateDefect(defect.id, { assigned_to: assignee || null })
      if (assignee && alsoAssigned && canAlsoSetAssigned) return updateDefectStatus(defect.id, { status: 'Assigned' })
      return updated
    },
    onSuccess: () => {
      refresh()
      show('success', assignee ? 'Defect assigned' : 'Defect unassigned')
      onClose()
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Could not assign the defect. Try again.'),
  })

  if (!canListUsers) {
    return (
      <div className="flex flex-col gap-3 text-sm">
        <p>Assigning needs access to the list of users, which your role does not have.</p>
        <DialogFooter>
          <Button size="sm" variant="outline" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </div>
    )
  }
  return (
    <div className="flex flex-col gap-3 text-sm">
      <p className="text-[var(--muted-foreground)]">
        <span className="font-mono">{defect.display_id ?? ''}</span> {defect.title}
      </p>
      <FormField id="assign-user" label="Assignee" helper="Must be an active member of the defect's project.">
        {(f) => (
          <Select {...f} value={assignee} onChange={(e) => setAssignee(e.target.value)}>
            <option value="">Unassigned</option>
            {(usersQuery.data ?? [])
              .filter((u) => u.is_active)
              .map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
          </Select>
        )}
      </FormField>
      {canAlsoSetAssigned && assignee && (
        <label className="flex items-start gap-2">
          <input type="checkbox" className="mt-1" checked={alsoAssigned} onChange={(e) => setAlsoAssigned(e.target.checked)} />
          Also set the status to Assigned.
        </label>
      )}
      <FormError>{error}</FormError>
      <DialogFooter>
        <Button size="sm" variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button size="sm" loading={mutation.isPending} disabled={assignee === (defect.assigned_to ?? '')} onClick={() => mutation.mutate()}>
          Save assignee
        </Button>
      </DialogFooter>
    </div>
  )
}

/** Start a retest: creates a Retest run with the defect's linked test cases, assigned to the chosen tester. */
export function RetestDialog({ defect, onClose }: { defect: ActionDefect | null; onClose: () => void }) {
  return (
    <Dialog open={defect !== null} onClose={onClose} title="Start retest" className="max-w-md">
      {defect && <RetestForm key={defect.id} defect={defect} onClose={onClose} />}
    </Dialog>
  )
}

function RetestForm({ defect, onClose }: { defect: ActionDefect; onClose: () => void }) {
  const refresh = useRefreshDefects()
  const { show } = useToast()
  const navigate = useNavigate()
  const canListUsers = useCanListUsers()
  const usersQuery = useQuery({ queryKey: ['users'], queryFn: listUsers, enabled: canListUsers })
  const [tester, setTester] = useState('')
  const [error, setError] = useState<string | null>(null)

  const mutation = useMutation({
    mutationFn: () => startDefectRetest(defect.id, { tester_id: tester || undefined }),
    onSuccess: (started) => {
      refresh()
      show('success', `Retest run "${started.test_run_name}" created`)
      onClose()
      navigate(`${defectPath(defect.project_id, defect.id)}?tab=retests`)
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Could not start the retest. Try again.'),
  })

  return (
    <div className="flex flex-col gap-3 text-sm">
      <p>
        A Retest run is created with the test cases linked to this defect, at their current versions. A Fixed defect moves to Retest. Earlier
        executions are kept: the retest is a new run case.
      </p>
      {canListUsers ? (
        <FormField id="retest-tester" label="Tester" helper="Who runs the retest. Defaults to the reporter. Must be a member of the project.">
          {(f) => (
            <Select {...f} value={tester} onChange={(e) => setTester(e.target.value)}>
              <option value="">Reporter (default)</option>
              {(usersQuery.data ?? [])
                .filter((u) => u.is_active)
                .map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
            </Select>
          )}
        </FormField>
      ) : (
        <p className="text-xs text-[var(--muted-foreground)]">The retest is assigned to the reporter.</p>
      )}
      <FormError>{error}</FormError>
      <DialogFooter>
        <Button size="sm" variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button size="sm" loading={mutation.isPending} onClick={() => mutation.mutate()}>
          Start retest
        </Button>
      </DialogFooter>
    </div>
  )
}
