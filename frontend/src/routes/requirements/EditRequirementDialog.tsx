import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'

import { ApiError } from '@/api/client'
import { listFieldOptions } from '@/api/fieldCustomization'
import { listProjectMembers } from '@/api/projects'
import { getRequirement, updateRequirement, type Requirement, type RequirementStatus } from '@/api/requirements'
import { StaleWriteNotice } from '@/components/StaleWriteNotice'
import { Button } from '@/components/ui/button'
import { Dialog, DialogFooter } from '@/components/ui/dialog'
import { FormError, FormField } from '@/components/ui/form-field'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { requirementPath } from '@/lib/entityRoutes'
import { CriteriaEditor } from '@/routes/requirements/CriteriaEditor'
import { approvalWillBeLost, REQUIREMENT_STATUS_LABEL, requirementChanges, type RequirementForm } from '@/lib/requirements'
import { isStaleWrite, rebaseValues } from '@/lib/staleWrite'
import { useToast } from '@/lib/toast'

const toForm = (r: Requirement): RequirementForm => ({
  title: r.title,
  description: r.description,
  requirement_type: r.requirement_type,
  priority: r.priority,
  status: r.status,
  owner_id: r.owner_id ?? '',
  acceptance_criteria: r.acceptance_criteria,
})

export function EditRequirementDialog({
  open,
  onClose,
  requirement,
  onSaved,
}: {
  open: boolean
  onClose: () => void
  requirement: Requirement
  onSaved: () => void
}) {
  return (
    <Dialog open={open} onClose={onClose} title="Edit Requirement" className="max-w-xl">
      {/* Mounted while open, so every opening starts from the saved copy. */}
      {open && <EditForm requirement={requirement} onClose={onClose} onSaved={onSaved} />}
    </Dialog>
  )
}

function EditForm({ requirement, onClose, onSaved }: { requirement: Requirement; onClose: () => void; onSaved: () => void }) {
  const { show: showToast } = useToast()
  // What the form was opened with, and the version it was read at (ADR-136).
  const [opened, setOpened] = useState(() => ({ values: toForm(requirement), version: requirement.row_version }))
  const [values, setValues] = useState(opened.values)
  const [staleFields, setStaleFields] = useState<(keyof RequirementForm)[] | null>(null)
  const set = <K extends keyof RequirementForm>(key: K, value: RequirementForm[K]) => setValues((v) => ({ ...v, [key]: value }))

  const types = useQuery({ queryKey: ['field-options', 'requirement_type'], queryFn: () => listFieldOptions('requirement_type') })
  const priorities = useQuery({
    queryKey: ['field-options', 'requirement_priority'],
    queryFn: () => listFieldOptions('requirement_priority'),
  })
  const members = useQuery({
    queryKey: ['project-members', requirement.project_id],
    queryFn: () => listProjectMembers(requirement.project_id),
  })

  const save = useMutation({
    mutationFn: async () => {
      setStaleFields(null)
      try {
        return await updateRequirement(requirement.id, {
          ...requirementChanges(opened.values, values),
          expected_version: opened.version,
        })
      } catch (err) {
        if (isStaleWrite(err)) {
          const latest = await getRequirement(requirement.id)
          const theirs = toForm(latest)
          const rebased = rebaseValues(values, opened.values, theirs)
          setValues(rebased.values)
          setOpened({ values: theirs, version: latest.row_version })
          setStaleFields(rebased.bothChanged)
          onSaved()
        }
        throw err
      }
    },
    onSuccess: (saved) => {
      onSaved()
      onClose()
      showToast('success', saved.version_number > requirement.version_number ? 'Requirement saved as a new version' : 'Requirement saved')
    },
  })

  const error = save.error instanceof ApiError && !isStaleWrite(save.error) ? save.error : null
  const unchanged = Object.keys(requirementChanges(opened.values, values)).length === 0
  const options = (items: { code: string; label: string }[] | undefined, current: string) => {
    const list = (items ?? []).map((o) => ({ value: o.code, label: o.label }))
    // A value the organization has since removed stays selectable on the record that has it.
    return list.some((o) => o.value === current) ? list : [{ value: current, label: current }, ...list]
  }

  return (
    <form
      className="flex flex-col gap-3 text-sm"
      onSubmit={(e) => {
        e.preventDefault()
        save.mutate()
      }}
    >
      {staleFields && <StaleWriteNotice bothChanged={staleFields as string[]} savedUrl={requirementPath(requirement.project_id, requirement.id)} />}
      <p className="text-xs text-[var(--muted-foreground)]">
        A changed title, description or acceptance criteria is saved as a new version; earlier wording stays in the version history.
      </p>
      <FormField id="edit-requirement-title" label="Title" required helper="At least 5 characters." error={error?.fields?.title}>
        {(f) => <Input {...f} value={values.title} onChange={(e) => set('title', e.target.value)} />}
      </FormField>
      <FormField id="edit-requirement-description" label="Description">
        {(f) => <Textarea {...f} rows={4} value={values.description} onChange={(e) => set('description', e.target.value)} />}
      </FormField>
      <CriteriaEditor
        value={values.acceptance_criteria}
        onChange={(next) => set('acceptance_criteria', next)}
        error={error?.fields?.acceptance_criteria}
      />
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField id="edit-requirement-type" label="Type" error={error?.fields?.requirement_type}>
          {(f) => (
            <Select {...f} value={values.requirement_type} onChange={(e) => set('requirement_type', e.target.value)}>
              {options(types.data, values.requirement_type).map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          )}
        </FormField>
        <FormField id="edit-requirement-priority" label="Priority" error={error?.fields?.priority}>
          {(f) => (
            <Select {...f} value={values.priority} onChange={(e) => set('priority', e.target.value)}>
              {options(priorities.data, values.priority).map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          )}
        </FormField>
        <FormField id="edit-requirement-status" label="Status">
          {(f) => (
            <Select {...f} value={values.status} onChange={(e) => set('status', e.target.value as RequirementStatus)}>
              {Object.entries(REQUIREMENT_STATUS_LABEL).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          )}
        </FormField>
        <FormField id="edit-requirement-owner" label="Owner" error={error?.fields?.owner_id}>
          {(f) => (
            <Select {...f} value={values.owner_id} onChange={(e) => set('owner_id', e.target.value)}>
              <option value="">No owner</option>
              {values.owner_id && !members.data?.some((m) => m.user_id === values.owner_id) && (
                <option value={values.owner_id}>{requirement.owner_name ?? 'Current owner'}</option>
              )}
              {(members.data ?? []).map((m) => (
                <option key={m.user_id} value={m.user_id}>
                  {m.name}
                </option>
              ))}
            </Select>
          )}
        </FormField>
      </div>
      {approvalWillBeLost(opened.values, values) && (
        <p role="note" className="rounded-md bg-[var(--status-warning-bg)] px-3 py-2">
          This requirement is approved. Saving new wording returns it to Draft.
        </p>
      )}
      <FormError>{error && !error.fields ? error.message : null}</FormError>
      <DialogFooter>
        <Button type="button" variant="outline" size="sm" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" size="sm" loading={save.isPending} disabled={unchanged || values.title.trim().length < 5}>
          Save requirement
        </Button>
      </DialogFooter>
    </form>
  )
}
