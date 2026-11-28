import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { ApiError } from '@/api/client'
import { listProjectMembers } from '@/api/projects'
import { updateTestPlan, type PlanStatus, type TestPlan } from '@/api/testPlans'
import { Button } from '@/components/ui/button'
import { Dialog, DialogFooter } from '@/components/ui/dialog'
import { FormError, FormField } from '@/components/ui/form-field'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { PLAN_STATUS_LABEL } from '@/lib/testPlans'
import { useToast } from '@/lib/toast'

/** ADR-153: who owns a plan, when it runs, where it stands, and what "done" means. */
export function PlanEditDialog({ plan, projectId, onClose }: { plan: TestPlan | null; projectId: string; onClose: () => void }) {
  return (
    <Dialog open={plan !== null} onClose={onClose} title="Edit test plan" className="max-w-xl">
      {plan && <PlanForm key={plan.id} plan={plan} projectId={projectId} onClose={onClose} />}
    </Dialog>
  )
}

function PlanForm({ plan, projectId, onClose }: { plan: TestPlan; projectId: string; onClose: () => void }) {
  const queryClient = useQueryClient()
  const { show: showToast } = useToast()
  const [name, setName] = useState(plan.name)
  const [owner, setOwner] = useState(plan.owner_id ?? '')
  const [start, setStart] = useState(plan.start_date ?? '')
  const [end, setEnd] = useState(plan.end_date ?? '')
  const [status, setStatus] = useState<PlanStatus>(plan.status)
  const [criteria, setCriteria] = useState(plan.exit_criteria ?? '')
  const members = useQuery({ queryKey: ['project-members', projectId], queryFn: () => listProjectMembers(projectId), retry: false })
  const backwards = !!start && !!end && end < start

  const save = useMutation({
    mutationFn: () =>
      updateTestPlan(plan.id, {
        name: name.trim(),
        owner_id: owner || null,
        start_date: start || null,
        end_date: end || null,
        status,
        exit_criteria: criteria.trim() || null,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['test-plans', projectId] })
      showToast('success', 'Test plan saved')
      onClose()
    },
  })
  const error = save.error instanceof ApiError ? save.error : null

  return (
    <form
      className="flex flex-col gap-3 text-sm"
      onSubmit={(e) => {
        e.preventDefault()
        save.mutate()
      }}
    >
      <FormField id="plan-name" label="Name" required>
        {(f) => <Input {...f} value={name} onChange={(e) => setName(e.target.value)} />}
      </FormField>
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField id="plan-owner" label="Owner" error={error?.fields?.owner_id}>
          {(f) => (
            <Select {...f} value={owner} onChange={(e) => setOwner(e.target.value)}>
              <option value="">No owner</option>
              {owner && !members.data?.some((m) => m.user_id === owner) && <option value={owner}>{plan.owner_name ?? 'Current owner'}</option>}
              {(members.data ?? []).map((m) => (
                <option key={m.user_id} value={m.user_id}>
                  {m.name}
                </option>
              ))}
            </Select>
          )}
        </FormField>
        <FormField id="plan-status" label="Status">
          {(f) => (
            <Select {...f} value={status} onChange={(e) => setStatus(e.target.value as PlanStatus)}>
              {Object.entries(PLAN_STATUS_LABEL).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          )}
        </FormField>
        <FormField id="plan-start" label="Starts">
          {(f) => <Input {...f} type="date" value={start} onChange={(e) => setStart(e.target.value)} />}
        </FormField>
        <FormField id="plan-end" label="Ends" error={backwards ? 'The end cannot be before the start' : error?.fields?.end_date}>
          {(f) => <Input {...f} type="date" value={end} onChange={(e) => setEnd(e.target.value)} />}
        </FormField>
      </div>
      <FormField
        id="plan-exit"
        label="Exit criteria"
        helper="What must be true to call this plan complete. This is a note; nothing checks it automatically."
      >
        {(f) => <Textarea {...f} rows={4} maxLength={5000} value={criteria} onChange={(e) => setCriteria(e.target.value)} />}
      </FormField>
      <FormError>{error && !error.fields ? error.message : null}</FormError>
      <DialogFooter>
        <Button type="button" variant="outline" size="sm" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" size="sm" loading={save.isPending} disabled={name.trim().length < 1 || backwards}>
          Save plan
        </Button>
      </DialogFooter>
    </form>
  )
}
