import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { ApiError } from '@/api/client'
import {
  createTaskStatus,
  deleteTaskStatus,
  listTaskStatuses,
  updateTaskStatus,
  type TaskStatus,
  type TaskStatusCategory,
} from '@/api/tasks'
import { TaskStatusBadge } from '@/components/TaskStatusBadge'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogFooter } from '@/components/ui/dialog'
import { ReportDirty } from '@/components/ui/dirtyForm'
import { EmptyState, ErrorState } from '@/components/ui/empty-state'
import { FormError, FormField } from '@/components/ui/form-field'
import { Input } from '@/components/ui/input'
import { PageHeader } from '@/components/ui/PageHeader'
import { Select } from '@/components/ui/select'
import { useConfirm } from '@/components/ui/useConfirm'
import { useToast } from '@/lib/toast'

const CATEGORY_LABELS: Record<TaskStatusCategory, string> = {
  todo: 'To do',
  in_progress: 'In progress',
  done: 'Done',
}
const CATEGORY_HELP: Record<TaskStatusCategory, string> = {
  todo: 'Work that has not started.',
  in_progress: 'Work under way.',
  done: 'Finished. A task can only be done once all its sub-tasks are.',
}
const DEFAULT_COLOR = '#64748b'

/** Admin > Task Statuses (ADR-127): the workflow statuses of tasks and sub-tasks for this tenant. */
export function TaskStatuses() {
  const queryClient = useQueryClient()
  const { show: showToast } = useToast()
  const { ask, dialog: confirmDialog } = useConfirm()
  const [editing, setEditing] = useState<TaskStatus | 'new' | null>(null)

  const query = useQuery({ queryKey: ['task-statuses'], queryFn: listTaskStatuses })
  const statuses = query.data ?? []

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteTaskStatus(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['task-statuses'] })
      showToast('success', 'Status deleted')
    },
    onError: (error) => showToast('error', error instanceof ApiError ? error.message : 'Could not delete the status'),
  })

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Task Statuses"
        description="The workflow statuses of tasks and sub-tasks. Rename them and choose their colours; each one belongs to a fixed category that decides what “done” means."
        actions={
          <Button size="sm" onClick={() => setEditing('new')}>
            New Status
          </Button>
        }
      />
      {confirmDialog}
      <Card>
        <CardHeader>
          <CardTitle>Statuses</CardTitle>
        </CardHeader>
        <CardContent>
          {query.isError ? (
            <ErrorState error={query.error} onRetry={() => query.refetch()} />
          ) : !query.isLoading && statuses.length === 0 ? (
            <EmptyState title="No statuses" description="Add a status to start using tasks." />
          ) : (
            <ul className="flex flex-col text-sm">
              {statuses.map((s) => (
                <li
                  key={s.id}
                  className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border)] py-3 last:border-0"
                >
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <TaskStatusBadge status={s} />
                    <span className="font-mono text-xs text-[var(--muted-foreground)]">{s.code}</span>
                    <span className="text-xs text-[var(--muted-foreground)]">{CATEGORY_LABELS[s.category]}</span>
                    {s.is_default && <Badge tone="info">Default for new tasks</Badge>}
                    <span className="text-xs text-[var(--muted-foreground)]">
                      {s.task_count === 1 ? '1 task' : `${s.task_count} tasks`}
                    </span>
                  </div>
                  <div className="flex gap-1">
                    <Button variant="ghost" size="sm" onClick={() => setEditing(s)}>
                      Edit
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={s.is_default || s.task_count > 0}
                      title={
                        s.is_default
                          ? 'Make another status the default first'
                          : s.task_count > 0
                            ? 'Tasks use this status'
                            : undefined
                      }
                      onClick={() =>
                        ask({
                          title: `Delete status “${s.label}”?`,
                          description: 'No task uses it. This cannot be undone.',
                          confirmLabel: 'Delete status',
                          run: () => deleteMutation.mutateAsync(s.id),
                        })
                      }
                    >
                      Delete
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
      <p className="text-xs text-[var(--muted-foreground)]">
        There must always be at least one “To do” and one “Done” status, and the default status for new tasks must be a
        “To do” status. A status that tasks use keeps its category.
      </p>

      {editing !== null && (
        <StatusDialog
          status={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            queryClient.invalidateQueries({ queryKey: ['task-statuses'] })
            queryClient.invalidateQueries({ queryKey: ['tasks'] })
            setEditing(null)
            showToast('success', 'Status saved')
          }}
        />
      )}
    </div>
  )
}

function StatusDialog({
  status,
  onClose,
  onSaved,
}: {
  status: TaskStatus | null
  onClose: () => void
  onSaved: () => void
}) {
  const [label, setLabel] = useState(status?.label ?? '')
  const [codeOverride, setCodeOverride] = useState<string | null>(null)
  const [category, setCategory] = useState<TaskStatusCategory>(status?.category ?? 'todo')
  const [color, setColor] = useState(status?.color ?? DEFAULT_COLOR)
  const [isDefault, setIsDefault] = useState(status?.is_default ?? false)
  // A new status suggests its code from its label until the code is edited by hand.
  const suggested = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40)
  const code = status ? status.code : (codeOverride ?? suggested)

  const locked = !!status && status.task_count > 0
  const mutation = useMutation({
    mutationFn: () =>
      status
        ? updateTaskStatus(status.id, { label, category, color, is_default: isDefault })
        : createTaskStatus({ code, label, category, color, is_default: isDefault }),
    onSuccess: onSaved,
  })
  const error = mutation.error instanceof ApiError ? mutation.error : null
  const codeValid = /^[a-z][a-z0-9_]{1,39}$/.test(code)
  const dirty = !status
    ? label !== '' || code !== ''
    : label !== status.label || category !== status.category || color !== (status.color ?? DEFAULT_COLOR) || isDefault !== status.is_default

  return (
    <Dialog open onClose={onClose} title={status ? 'Edit status' : 'New status'}>
      <div className="flex flex-col gap-3 text-sm">
        <ReportDirty dirty={dirty} />
        <FormField id="status-label" label="Label" required error={error?.fields?.label}>
          {(f) => <Input {...f} value={label} maxLength={40} onChange={(e) => setLabel(e.target.value)} />}
        </FormField>
        <FormField
          id="status-code"
          label="Code"
          required
          error={error?.fields?.code}
          helper={status ? 'The code cannot change.' : 'Lowercase letters, digits and underscores; starts with a letter.'}
        >
          {(f) => (
            <Input
              {...f}
              value={code}
              disabled={!!status}
              onChange={(e) => setCodeOverride(e.target.value)}
            />
          )}
        </FormField>
        <FormField
          id="status-category"
          label="Category"
          helper={locked ? 'Tasks use this status, so its category is fixed.' : CATEGORY_HELP[category]}
        >
          {(f) => (
            <Select {...f} value={category} disabled={locked} onChange={(e) => setCategory(e.target.value as TaskStatusCategory)}>
              {(Object.keys(CATEGORY_LABELS) as TaskStatusCategory[]).map((c) => (
                <option key={c} value={c}>
                  {CATEGORY_LABELS[c]}
                </option>
              ))}
            </Select>
          )}
        </FormField>
        <FormField id="status-color" label="Colour" error={error?.fields?.color}>
          {(f) => <input {...f} type="color" value={color} onChange={(e) => setColor(e.target.value)} className="h-10 w-16 rounded-md border border-[var(--border)] bg-transparent p-1" />}
        </FormField>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={isDefault}
            disabled={category !== 'todo' || status?.is_default}
            onChange={(e) => setIsDefault(e.target.checked)}
          />
          Default status for new tasks
          {category !== 'todo' && <span className="text-xs text-[var(--muted-foreground)]">(To do statuses only)</span>}
        </label>
        <FormError>{error && !error.fields ? error.message : null}</FormError>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" disabled={mutation.isPending || label.trim() === '' || !codeValid || (!!status && !dirty)} onClick={() => mutation.mutate()}>
            {mutation.isPending ? 'Saving…' : 'Save'}
          </Button>
        </DialogFooter>
      </div>
    </Dialog>
  )
}
