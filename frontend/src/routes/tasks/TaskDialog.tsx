import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { hasPermission } from '@/api/auth'
import { ApiError } from '@/api/client'
import { listFieldOptions } from '@/api/fieldCustomization'
import { listProjectMembers } from '@/api/projects'
import {
  changeTaskStatus,
  createTask,
  deleteTask,
  getTask,
  listTaskStatuses,
  updateTask,
  type TaskCreateRequest,
  type TaskDetail,
  type TaskUpdateRequest,
} from '@/api/tasks'
import { listReleases } from '@/api/testAssets'
import { TaskPicker } from '@/components/TaskPicker'
import { TaskStatusBadge } from '@/components/TaskStatusBadge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogFooter } from '@/components/ui/dialog'
import { ReportDirty } from '@/components/ui/dirtyForm'
import { FormError, FormField } from '@/components/ui/form-field'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { useConfirm } from '@/components/ui/useConfirm'
import { useAuth } from '@/lib/auth'
import { taskLabel } from '@/lib/taskTree'
import { useToast } from '@/lib/toast'

interface FormValues {
  title: string
  description: string
  parent_task_id: string
  priority: string
  assignee_id: string
  release_id: string
  start_date: string
  due_date: string
}

const EMPTY: FormValues = {
  title: '',
  description: '',
  parent_task_id: '',
  priority: '',
  assignee_id: '',
  release_id: '',
  start_date: '',
  due_date: '',
}

function fromTask(task: TaskDetail): FormValues {
  return {
    title: task.title,
    description: task.description ?? '',
    parent_task_id: task.parent_task_id ?? '',
    priority: task.priority,
    assignee_id: task.assignee_id ?? '',
    release_id: task.release_id ?? '',
    start_date: task.start_date ?? '',
    due_date: task.due_date ?? '',
  }
}

/**
 * Create a task (or sub-task, when `parentId` is set) or edit one (`taskId`). The status changes
 * immediately through its own control (it has its own rules and permission); the other fields save
 * together. Without `task.manage` the dialog is read-only, except that an assignee may move the
 * status of their own task.
 */
export function TaskDialog({
  projectId,
  taskId,
  parentId,
  open,
  onClose,
  onAddSubTask,
  onOpenTask,
}: {
  projectId: string
  /** Edit this task; omit to create. */
  taskId?: string | null
  /** Create under this parent (a sub-task). */
  parentId?: string | null
  open: boolean
  onClose: () => void
  onAddSubTask?: (parentId: string) => void
  onOpenTask?: (taskId: string) => void
}) {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const { show: showToast } = useToast()
  const { ask, dialog: confirmDialog } = useConfirm()
  const editing = !!taskId
  const canManage = hasPermission(user, 'task.manage')
  const canTransition = hasPermission(user, 'task.transition')

  const [values, setValues] = useState<FormValues>(EMPTY)
  const [initial, setInitial] = useState<FormValues>(EMPTY)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState<string | null>(null)

  const taskQuery = useQuery({
    queryKey: ['tasks', 'detail', taskId],
    queryFn: () => getTask(taskId!),
    enabled: open && editing,
  })
  const task = taskQuery.data
  const statusesQuery = useQuery({ queryKey: ['task-statuses'], queryFn: listTaskStatuses, enabled: open })
  const priorityQuery = useQuery({
    queryKey: ['field-options', 'task_priority'],
    queryFn: () => listFieldOptions('task_priority'),
    enabled: open,
  })
  const membersQuery = useQuery({
    queryKey: ['project-members', projectId],
    queryFn: () => listProjectMembers(projectId),
    enabled: open && canManage,
  })
  const releasesQuery = useQuery({
    queryKey: ['releases', projectId],
    queryFn: () => listReleases(projectId),
    enabled: open && canManage,
  })

  // Load the form: a fresh one for create, the task's values once it has arrived for edit.
  useEffect(() => {
    if (!open) return
    setFieldErrors({})
    setFormError(null)
    if (editing) {
      if (task) {
        const next = fromTask(task)
        setValues(next)
        setInitial(next)
      }
    } else {
      const next = { ...EMPTY, parent_task_id: parentId ?? '' }
      setValues(next)
      setInitial(next)
    }
  }, [open, editing, task, parentId])

  const priorities = useMemo(() => priorityQuery.data ?? [], [priorityQuery.data])
  useEffect(() => {
    // New task: start on the middle/default priority the server would pick.
    if (open && !editing && values.priority === '' && priorities.length > 0) {
      const preferred = priorities.find((p) => p.code === 'Medium') ?? priorities[0]
      setValues((v) => ({ ...v, priority: preferred.code }))
      setInitial((v) => ({ ...v, priority: preferred.code }))
    }
  }, [open, editing, priorities, values.priority])

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ['tasks'] })
    queryClient.invalidateQueries({ queryKey: ['requirements', projectId] })
  }

  function fail(error: unknown) {
    if (error instanceof ApiError) {
      setFieldErrors(error.fields ?? {})
      setFormError(error.fields && Object.keys(error.fields).length > 0 ? null : error.message)
    } else {
      setFormError('Something went wrong. Try again.')
    }
  }

  const saveMutation = useMutation({
    mutationFn: () => {
      const trimmed = values.title.trim()
      if (!editing) {
        const req: TaskCreateRequest = { title: trimmed }
        if (values.description) req.description = values.description
        if (values.parent_task_id) req.parent_task_id = values.parent_task_id
        if (values.priority) req.priority = values.priority
        if (values.assignee_id) req.assignee_id = values.assignee_id
        if (values.release_id) req.release_id = values.release_id
        if (values.start_date) req.start_date = values.start_date
        if (values.due_date) req.due_date = values.due_date
        return createTask(projectId, req)
      }
      const req: TaskUpdateRequest = {}
      if (trimmed !== initial.title) req.title = trimmed
      if (values.description !== initial.description) req.description = values.description || null
      if (values.parent_task_id !== initial.parent_task_id) req.parent_task_id = values.parent_task_id || null
      if (values.priority !== initial.priority) req.priority = values.priority
      if (values.assignee_id !== initial.assignee_id) req.assignee_id = values.assignee_id || null
      if (values.release_id !== initial.release_id) req.release_id = values.release_id || null
      if (values.start_date !== initial.start_date) req.start_date = values.start_date || null
      if (values.due_date !== initial.due_date) req.due_date = values.due_date || null
      return updateTask(taskId!, req)
    },
    onSuccess: () => {
      invalidate()
      showToast('success', editing ? 'Task saved' : parentId ? 'Sub-task created' : 'Task created')
      onClose()
    },
    onError: fail,
  })

  const statusMutation = useMutation({
    mutationFn: (statusId: string) => changeTaskStatus(taskId!, statusId),
    onSuccess: () => {
      setFormError(null)
      invalidate()
      showToast('success', 'Status updated')
    },
    onError: fail,
  })

  const deleteMutation = useMutation({
    mutationFn: (cascade: boolean) => deleteTask(taskId!, cascade),
    onSuccess: (result) => {
      invalidate()
      showToast('success', result.deleted > 1 ? `${result.deleted} tasks deleted` : 'Task deleted')
      onClose()
    },
    onError: () => showToast('error', 'Could not delete the task'),
  })

  const isAssignee = !!task && task.assignee_id === user?.user_id
  const canChangeStatus = editing && (canManage || (canTransition && isAssignee))
  const readOnly = editing ? !canManage : false
  const dirty = JSON.stringify(values) !== JSON.stringify(initial)
  const set = <K extends keyof FormValues>(key: K, value: FormValues[K]) =>
    setValues((v) => ({ ...v, [key]: value }))
  const title = editing ? 'Task' : parentId ? 'New sub-task' : 'New task'
  const members = membersQuery.data ?? []
  const releases = releasesQuery.data ?? []

  return (
    <Dialog open={open} onClose={onClose} title={title}>
      {confirmDialog}
      <div className="flex flex-col gap-3 text-sm">
        <ReportDirty dirty={dirty && !readOnly} />

        {editing && taskQuery.isLoading && <p className="text-[var(--muted-foreground)]">Loading…</p>}
        {editing && taskQuery.isError && <FormError>Could not load this task.</FormError>}

        {editing && task && (
          <div className="flex flex-col gap-1">
            {task.ancestors.length > 0 && (
              <p className="text-xs text-[var(--muted-foreground)]">
                {task.ancestors.map((a, i) => (
                  <span key={a.id}>
                    {i > 0 && ' › '}
                    <button type="button" className="underline-offset-2 hover:underline" onClick={() => onOpenTask?.(a.id)}>
                      {taskLabel(a)}
                    </button>
                  </span>
                ))}
              </p>
            )}
            <p className="font-mono text-xs text-[var(--muted-foreground)]">{task.display_id}</p>
          </div>
        )}

        {editing && task?.is_requirements_home && (
          <p role="note" className="rounded-md bg-[var(--muted)] px-3 py-2 text-xs">
            Requirements that are not in another task are kept here. Open a requirement and move it to the
            task it belongs to. This task cannot be deleted or moved and takes no sub-tasks.
          </p>
        )}

        {(!editing || task) && (
          <>
            <FormField id="task-title" label="Title" required error={fieldErrors.title} helper="3 to 255 characters.">
              {(f) => (
                <Input {...f} value={values.title} disabled={readOnly} onChange={(e) => set('title', e.target.value)} />
              )}
            </FormField>

            <FormField id="task-description" label="Description" error={fieldErrors.description}>
              {(f) => (
                <Textarea
                  {...f}
                  rows={4}
                  value={values.description}
                  disabled={readOnly}
                  onChange={(e) => set('description', e.target.value)}
                />
              )}
            </FormField>

            {editing && task && (
              <FormField id="task-status" label="Status" error={undefined}>
                {(f) =>
                  canChangeStatus ? (
                    <Select
                      {...f}
                      value={task.status.id}
                      disabled={statusMutation.isPending}
                      onChange={(e) => statusMutation.mutate(e.target.value)}
                    >
                      {(statusesQuery.data ?? []).map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.label}
                        </option>
                      ))}
                    </Select>
                  ) : (
                    <div id={f.id}>
                      <TaskStatusBadge status={task.status} />
                    </div>
                  )
                }
              </FormField>
            )}

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <FormField id="task-parent" label="Parent task" error={fieldErrors.parent_task_id}>
                {(f) => (
                  <TaskPicker
                    id={f.id}
                    projectId={projectId}
                    value={values.parent_task_id}
                    onChange={(v) => set('parent_task_id', v)}
                    movingId={taskId ?? null}
                    forParent
                    disabled={readOnly || task?.is_requirements_home}
                    placeholder="None (top level)"
                    error={!!fieldErrors.parent_task_id}
                  />
                )}
              </FormField>
              <FormField id="task-priority" label="Priority" error={fieldErrors.priority}>
                {(f) => (
                  <Select {...f} value={values.priority} disabled={readOnly} onChange={(e) => set('priority', e.target.value)}>
                    {priorities.map((p) => (
                      <option key={p.id} value={p.code}>
                        {p.label}
                      </option>
                    ))}
                  </Select>
                )}
              </FormField>
              <FormField id="task-assignee" label="Assignee" error={fieldErrors.assignee_id}>
                {(f) => (
                  <Select {...f} value={values.assignee_id} disabled={readOnly || !canManage} onChange={(e) => set('assignee_id', e.target.value)}>
                    <option value="">Unassigned</option>
                    {members.map((m) => (
                      <option key={m.user_id} value={m.user_id}>
                        {m.name}
                      </option>
                    ))}
                  </Select>
                )}
              </FormField>
              <FormField id="task-release" label="Release" error={fieldErrors.release_id}>
                {(f) => (
                  <Select {...f} value={values.release_id} disabled={readOnly || !canManage} onChange={(e) => set('release_id', e.target.value)}>
                    <option value="">None</option>
                    {releases.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                      </option>
                    ))}
                  </Select>
                )}
              </FormField>
              <FormField id="task-start" label="Start date" error={fieldErrors.start_date}>
                {(f) => (
                  <Input {...f} type="date" value={values.start_date} disabled={readOnly} onChange={(e) => set('start_date', e.target.value)} />
                )}
              </FormField>
              <FormField id="task-due" label="Due date" error={fieldErrors.due_date}>
                {(f) => (
                  <Input {...f} type="date" value={values.due_date} disabled={readOnly} onChange={(e) => set('due_date', e.target.value)} />
                )}
              </FormField>
            </div>
          </>
        )}

        {editing && task && (
          <section aria-labelledby="task-subtasks-heading" className="flex flex-col gap-2 border-t border-[var(--border)] pt-3">
            <div className="flex items-center justify-between">
              <h3 id="task-subtasks-heading" className="text-sm font-medium">
                Sub-tasks ({task.sub_tasks_done} of {task.sub_task_count} done)
              </h3>
              {canManage && task.depth < 4 && !task.is_requirements_home && (
                <Button variant="outline" size="sm" onClick={() => onAddSubTask?.(task.id)}>
                  Add sub-task
                </Button>
              )}
            </div>
            {task.sub_tasks.length === 0 ? (
              <p className="text-[var(--muted-foreground)]">No sub-tasks.</p>
            ) : (
              <ul className="flex flex-col gap-1">
                {task.sub_tasks.map((s) => (
                  <li key={s.id} className="flex items-center justify-between gap-2">
                    <button type="button" className="min-w-0 truncate text-left underline-offset-2 hover:underline" onClick={() => onOpenTask?.(s.id)}>
                      {taskLabel(s)}
                    </button>
                    <TaskStatusBadge status={s.status} />
                  </li>
                ))}
              </ul>
            )}
            <p className="text-xs text-[var(--muted-foreground)]">
              {task.requirement_count} requirement(s) · {task.defect_count} defect(s) · {task.test_case_count} test case(s)
            </p>
          </section>
        )}

        <FormError>{formError}</FormError>

        <DialogFooter>
          {editing && task && canManage && !task.is_requirements_home && (
            <Button
              variant="outline"
              size="sm"
              className="mr-auto"
              onClick={() =>
                ask({
                  title: `Delete ${task.display_id ?? 'this task'}?`,
                  description:
                    task.sub_task_count > 0
                      ? `This also deletes its ${task.sub_task_count} sub-task(s). Requirements and defects that point at them stay, but lose the task.`
                      : 'Requirements and defects that point at this task stay, but lose the task.',
                  confirmLabel: 'Delete task',
                  run: () => deleteMutation.mutateAsync(task.sub_task_count > 0),
                })
              }
            >
              Delete
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={onClose}>
            {readOnly ? 'Close' : 'Cancel'}
          </Button>
          {!readOnly && (
            <Button
              size="sm"
              disabled={saveMutation.isPending || values.title.trim().length < 3 || (editing && !dirty)}
              onClick={() => {
                setFieldErrors({})
                setFormError(null)
                saveMutation.mutate()
              }}
            >
              {saveMutation.isPending ? 'Saving…' : editing ? 'Save' : 'Create'}
            </Button>
          )}
        </DialogFooter>
      </div>
    </Dialog>
  )
}
