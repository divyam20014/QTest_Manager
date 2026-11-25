import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { ApiError } from '@/api/client'
import { createRequirement, type Requirement } from '@/api/requirements'
import { TaskPicker } from '@/components/TaskPicker'
import { Button } from '@/components/ui/button'
import { Dialog, DialogFooter } from '@/components/ui/dialog'
import { ReportDirty } from '@/components/ui/dirtyForm'
import { FormError, FormField } from '@/components/ui/form-field'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/lib/toast'

/**
 * Create a requirement (ADR-128: requirements live in tasks). With `taskId` it is created in that
 * task and the task is not asked for; without it the person may pick one, and a requirement left
 * without a task is filed under the project's "Unassigned requirements" task.
 */
export function NewRequirementDialog({
  open,
  onClose,
  projectId,
  taskId,
  onCreated,
}: {
  open: boolean
  onClose: () => void
  projectId: string
  /** Create in this task (the task page); omit to let the person choose. */
  taskId?: string
  onCreated?: (requirement: Requirement) => void
}) {
  const queryClient = useQueryClient()
  const { show: showToast } = useToast()
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [pickedTask, setPickedTask] = useState('')

  const mutation = useMutation({
    mutationFn: () =>
      createRequirement(projectId, {
        title,
        description,
        ...(taskId || pickedTask ? { task_id: taskId || pickedTask } : {}),
      }),
    onSuccess: (requirement) => {
      void queryClient.invalidateQueries({ queryKey: ['requirements'] })
      void queryClient.invalidateQueries({ queryKey: ['requirements-coverage'] })
      void queryClient.invalidateQueries({ queryKey: ['traceability-matrix'] })
      void queryClient.invalidateQueries({ queryKey: ['tasks'] })
      setTitle('')
      setDescription('')
      setPickedTask('')
      showToast('success', 'Requirement created')
      onCreated?.(requirement)
      onClose()
    },
    // No onError toast: the message is shown inline below.
  })
  const error = mutation.error instanceof ApiError ? mutation.error : null

  return (
    <Dialog open={open} onClose={onClose} title="New Requirement">
      <div className="flex flex-col gap-3 text-sm">
        <ReportDirty dirty={title !== '' || description !== '' || pickedTask !== ''} />
        <FormField id="requirement-title" label="Title" required helper="At least 5 characters." error={error?.fields?.title}>
          {(field) => <Input {...field} value={title} onChange={(e) => setTitle(e.target.value)} />}
        </FormField>
        <FormField id="requirement-description" label="Description">
          {(field) => <Textarea {...field} value={description} onChange={(e) => setDescription(e.target.value)} />}
        </FormField>
        {!taskId && (
          <FormField
            id="requirement-task"
            label="Task"
            helper="Optional. Without one, the requirement is filed under “Unassigned requirements”."
            error={error?.fields?.task_id}
          >
            {(field) => <TaskPicker id={field.id} projectId={projectId} value={pickedTask} onChange={setPickedTask} />}
          </FormField>
        )}
        <FormError>{error && !error.fields ? error.message : null}</FormError>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" disabled={mutation.isPending || title.trim().length < 5} onClick={() => mutation.mutate()}>
            {mutation.isPending ? 'Creating…' : 'Create Requirement'}
          </Button>
        </DialogFooter>
      </div>
    </Dialog>
  )
}
