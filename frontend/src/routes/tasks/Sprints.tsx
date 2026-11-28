import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'

import { ApiError } from '@/api/client'
import {
  closeSprint,
  createSprint,
  deleteSprint,
  getSprint,
  listSprints,
  setTaskSprint,
  startSprint,
  updateSprint,
  type Sprint,
  type SprintDetail,
  type SprintTask,
} from '@/api/planning'
import { TaskStatusBadge } from '@/components/TaskStatusBadge'
import { Badge } from '@/components/ui/badge'
import { Button, buttonVariants } from '@/components/ui/button'
import { Dialog, DialogFooter } from '@/components/ui/dialog'
import { EmptyState, ErrorState } from '@/components/ui/empty-state'
import { FormError, FormField } from '@/components/ui/form-field'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { DetailSkeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { useConfirm } from '@/components/ui/useConfirm'
import { formatHours, SPRINT_STATE_LABEL, sprintFlags } from '@/lib/planning'
import { useToast } from '@/lib/toast'

const errorText = (err: unknown, fallback: string) => (err instanceof ApiError ? err.message : fallback)
const STATE_TONE = { planned: 'neutral', active: 'info', closed: 'positive' } as const
const BACKLOG = 'backlog'

/** ADR-146: the project's sprints, and what the chosen one holds. */
export function Sprints({
  projectId,
  canPlan,
  selectedId,
  onSelect,
}: {
  projectId: string
  canPlan: boolean
  /** From the URL; without one the active sprint (or the next one) is shown. */
  selectedId: string
  onSelect: (sprintId: string) => void
}) {
  const [creating, setCreating] = useState(false)
  const list = useQuery({ queryKey: ['sprints', projectId], queryFn: () => listSprints(projectId) })
  const sprints = list.data ?? []
  const selected = sprints.find((s) => s.id === selectedId) ?? sprints[0]
  const refresh = useRefresh(projectId)

  if (list.isLoading) return <DetailSkeleton />
  if (list.isError) return <ErrorState message="Could not load sprints." error={list.error} onRetry={() => list.refetch()} />

  const newButton = canPlan ? (
    <Button size="sm" variant="outline" onClick={() => setCreating(true)}>
      New sprint
    </Button>
  ) : undefined

  return (
    <div className="flex flex-col gap-4">
      {selected ? (
        <>
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-56">
              <FormField id="sprint-picker" label="Sprint">
                {(f) => (
                  <Select {...f} value={selected.id} onChange={(e) => onSelect(e.target.value)}>
                    {sprints.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name} ({SPRINT_STATE_LABEL[s.state].toLowerCase()})
                      </option>
                    ))}
                  </Select>
                )}
              </FormField>
            </div>
            {newButton}
          </div>
          <SprintPanel key={selected.id} projectId={projectId} sprint={selected} sprints={sprints} canPlan={canPlan} />
        </>
      ) : (
        <EmptyState title="No sprints yet" description="A sprint is a short, dated set of tasks the team plans to finish." action={newButton} />
      )}
      <Dialog open={creating} onClose={() => setCreating(false)} title="New sprint" className="max-w-lg">
        {creating && (
          <SprintForm
            projectId={projectId}
            onCancel={() => setCreating(false)}
            onDone={(made) => {
              setCreating(false)
              refresh()
              onSelect(made.id)
            }}
          />
        )}
      </Dialog>
    </div>
  )
}

function useRefresh(projectId: string) {
  const queryClient = useQueryClient()
  return () => {
    void queryClient.invalidateQueries({ queryKey: ['sprints', projectId] })
    void queryClient.invalidateQueries({ queryKey: ['sprint'] })
    void queryClient.invalidateQueries({ queryKey: ['tasks'] })
  }
}

function SprintPanel({ projectId, sprint, sprints, canPlan }: { projectId: string; sprint: Sprint; sprints: Sprint[]; canPlan: boolean }) {
  const refresh = useRefresh(projectId)
  const { show: showToast } = useToast()
  const { ask, dialog: confirmDialog } = useConfirm()
  const [editing, setEditing] = useState(false)
  const [closing, setClosing] = useState(false)
  const detail = useQuery({ queryKey: ['sprint', sprint.id], queryFn: () => getSprint(sprint.id) })
  const running = sprints.find((s) => s.state === 'active')

  const fail = (fallback: string) => (err: unknown) => {
    showToast('error', errorText(err, fallback))
    refresh()
  }
  const start = useMutation({
    mutationFn: () => startSprint(sprint.id),
    onSuccess: () => {
      refresh()
      showToast('success', 'Sprint started')
    },
    onError: fail('Could not start the sprint'),
  })
  const remove = useMutation({ mutationFn: () => deleteSprint(sprint.id), onSuccess: refresh, onError: fail('Could not delete the sprint') })
  const takeOut = useMutation({
    mutationFn: (taskId: string) => setTaskSprint(taskId, null),
    onSuccess: refresh,
    onError: fail('Could not remove the task'),
  })

  return (
    <section aria-label={sprint.name} className="flex flex-col gap-3">
      {confirmDialog}
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-base font-semibold">{sprint.name}</h2>
        <Badge tone={STATE_TONE[sprint.state]}>{SPRINT_STATE_LABEL[sprint.state]}</Badge>
        <span className="text-sm text-[var(--muted-foreground)]">
          {sprint.start_date} to {sprint.end_date}
        </span>
      </div>
      {sprint.goal && <p className="whitespace-pre-wrap text-sm">{sprint.goal}</p>}
      <div className="flex flex-wrap items-center gap-2">
        {sprint.state !== 'closed' && (
          <Link to={`/projects/${projectId}/tasks?view=board&sprint=${sprint.id}`} className={buttonVariants({ variant: 'outline', size: 'sm' })}>
            Open board
          </Link>
        )}
        {canPlan && sprint.state === 'planned' && (
          <>
            <Button size="sm" disabled={!!running} loading={start.isPending} onClick={() => start.mutate()}>
              Start sprint
            </Button>
            <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
              Edit
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() =>
                ask({
                  title: `Delete sprint “${sprint.name}”?`,
                  description: 'Its tasks are kept and return to the backlog.',
                  confirmLabel: 'Delete sprint',
                  run: () => remove.mutateAsync(),
                })
              }
            >
              Delete
            </Button>
            {running && <span className="text-xs text-[var(--muted-foreground)]">Close “{running.name}” before starting this one.</span>}
          </>
        )}
        {canPlan && sprint.state === 'active' && (
          <>
            <Button size="sm" disabled={!detail.data} onClick={() => setClosing(true)}>
              Close sprint
            </Button>
            <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
              Edit
            </Button>
          </>
        )}
      </div>

      {detail.isLoading ? (
        <DetailSkeleton />
      ) : detail.isError ? (
        <ErrorState message="Could not load this sprint." error={detail.error} onRetry={() => detail.refetch()} />
      ) : detail.data ? (
        <>
          <Totals sprint={detail.data} />
          {detail.data.tasks.length === 0 ? (
            <EmptyState
              title="No tasks in this sprint"
              description={sprint.state === 'closed' ? 'It was closed without any tasks.' : 'Add tasks to it from the backlog.'}
              action={
                sprint.state !== 'closed' ? (
                  <Link to={`/projects/${projectId}/tasks?view=backlog`} className={buttonVariants({ variant: 'outline', size: 'sm' })}>
                    Go to the backlog
                  </Link>
                ) : undefined
              }
            />
          ) : (
            <ul aria-label="Sprint tasks" className="flex flex-col divide-y divide-[var(--border)] rounded-xl border border-[var(--border)]">
              {detail.data.tasks.map((t) => (
                <SprintTaskRow
                  key={t.task_id}
                  projectId={projectId}
                  task={t}
                  state={sprint.state}
                  onRemove={canPlan && sprint.state !== 'closed' && !t.removed_at ? () => takeOut.mutate(t.task_id) : undefined}
                  busy={takeOut.isPending}
                />
              ))}
            </ul>
          )}
        </>
      ) : null}

      <Dialog open={editing} onClose={() => setEditing(false)} title="Edit sprint" className="max-w-lg">
        {editing && (
          <SprintForm
            projectId={projectId}
            sprint={sprint}
            onCancel={() => setEditing(false)}
            onDone={() => {
              setEditing(false)
              refresh()
            }}
          />
        )}
      </Dialog>
      <Dialog open={closing} onClose={() => setClosing(false)} title={`Close “${sprint.name}”`} className="max-w-lg">
        {closing && detail.data && (
          <CloseSprintForm
            sprint={detail.data}
            planned={sprints.filter((s) => s.state === 'planned')}
            onCancel={() => setClosing(false)}
            onDone={() => {
              setClosing(false)
              refresh()
              showToast('success', 'Sprint closed')
            }}
          />
        )}
      </Dialog>
    </section>
  )
}

function Totals({ sprint }: { sprint: SprintDetail }) {
  const { totals, state } = sprint
  const shown: [string, SprintDetail['totals']['planned']][] =
    state === 'planned'
      ? [['Planned', totals.planned]]
      : [
          ['Planned', totals.planned],
          ['Added', totals.added],
          ['Removed', totals.removed],
          ['Done', totals.completed],
          [state === 'closed' ? 'Not done' : 'Still open', totals.unfinished],
        ]
  return (
    <dl aria-label="Sprint totals" className="flex flex-wrap gap-2">
      {shown.map(([label, total]) => (
        <div key={label} className="min-w-28 rounded-xl border border-[var(--border)] px-3 py-2">
          <dt className="text-xs text-[var(--muted-foreground)]">{label}</dt>
          <dd className="text-sm font-medium tabular-nums">
            {total.count} task{total.count === 1 ? '' : 's'} · {formatHours(total.hours)}
          </dd>
        </div>
      ))}
    </dl>
  )
}

function SprintTaskRow({
  projectId,
  task,
  state,
  onRemove,
  busy,
}: {
  projectId: string
  task: SprintTask
  state: Sprint['state']
  onRemove?: () => void
  busy: boolean
}) {
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm">
      <span className="shrink-0 font-mono text-xs">{task.display_id}</span>
      {task.deleted ? (
        <span className="min-w-0 flex-1 basis-48 font-medium">{task.title}</span>
      ) : (
        <Link to={`/projects/${projectId}/tasks/${task.task_id}`} className="min-w-0 flex-1 basis-48 font-medium underline-offset-2 hover:underline">
          {task.title}
        </Link>
      )}
      {sprintFlags(task, state).map((flag) => (
        <Badge key={flag.label} tone={flag.tone}>
          {flag.label}
        </Badge>
      ))}
      {/* A closed sprint's rows show today's status, so say which is which. */}
      <span className="flex items-center gap-1">
        {state === 'closed' && <span className="text-xs text-[var(--muted-foreground)]">Now</span>}
        <TaskStatusBadge status={task.status} />
      </span>
      <span className="w-16 shrink-0 text-right tabular-nums" title="Estimate">
        {formatHours(task.estimate_hours)}
      </span>
      <span className="w-32 shrink-0 truncate text-[var(--muted-foreground)]">{task.assignee_name ?? 'Unassigned'}</span>
      {onRemove && (
        <Button variant="ghost" size="sm" className="max-md:min-h-11" aria-label={`Remove ${task.title} from the sprint`} disabled={busy} onClick={onRemove}>
          Remove
        </Button>
      )}
    </li>
  )
}

function SprintForm({
  projectId,
  sprint,
  onDone,
  onCancel,
}: {
  projectId: string
  sprint?: Sprint
  onDone: (sprint: Sprint) => void
  onCancel: () => void
}) {
  const [name, setName] = useState(sprint?.name ?? '')
  const [goal, setGoal] = useState(sprint?.goal ?? '')
  const [startDate, setStartDate] = useState(sprint?.start_date ?? '')
  const [endDate, setEndDate] = useState(sprint?.end_date ?? '')
  const backwards = !!startDate && !!endDate && endDate < startDate
  const save = useMutation({
    mutationFn: () => {
      const req = { name: name.trim(), goal: goal || null, start_date: startDate, end_date: endDate }
      return sprint ? updateSprint(sprint.id, req) : createSprint(projectId, req)
    },
    onSuccess: onDone,
  })
  return (
    <form
      className="flex flex-col gap-3 text-sm"
      onSubmit={(e) => {
        e.preventDefault()
        save.mutate()
      }}
    >
      <FormField id="sprint-name" label="Name" required>
        {(f) => <Input {...f} value={name} maxLength={120} autoComplete="off" onChange={(e) => setName(e.target.value)} />}
      </FormField>
      <FormField id="sprint-goal" label="Goal">
        {(f) => <Textarea {...f} rows={2} maxLength={2000} value={goal} onChange={(e) => setGoal(e.target.value)} />}
      </FormField>
      <div className="flex flex-wrap gap-3">
        <FormField id="sprint-start" label="Starts" required>
          {(f) => <Input {...f} type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />}
        </FormField>
        <FormField id="sprint-end" label="Ends" required error={backwards ? 'The end cannot be before the start' : undefined}>
          {(f) => <Input {...f} type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />}
        </FormField>
      </div>
      <FormError>{save.error ? errorText(save.error, 'Could not save the sprint') : null}</FormError>
      <DialogFooter>
        <Button type="button" variant="outline" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" size="sm" loading={save.isPending} disabled={name.trim().length < 2 || !startDate || !endDate || backwards}>
          {sprint ? 'Save sprint' : 'Create sprint'}
        </Button>
      </DialogFooter>
    </form>
  )
}

function CloseSprintForm({ sprint, planned, onDone, onCancel }: { sprint: SprintDetail; planned: Sprint[]; onDone: () => void; onCancel: () => void }) {
  const unfinished = sprint.totals.unfinished.count
  const done = sprint.totals.completed.count
  // Nothing is chosen for them: where unfinished work goes is the closer's decision.
  const [choice, setChoice] = useState('')
  const close = useMutation({
    mutationFn: () => closeSprint(sprint.id, unfinished === 0 || choice === BACKLOG ? null : choice),
    onSuccess: onDone,
  })
  return (
    <form
      className="flex flex-col gap-3 text-sm"
      onSubmit={(e) => {
        e.preventDefault()
        close.mutate()
      }}
    >
      <p>
        {done} task{done === 1 ? ' is' : 's are'} done and {unfinished} {unfinished === 1 ? 'is' : 'are'} not. The sprint keeps a record
        of what was planned, added, removed and done. A closed sprint cannot be reopened or changed.
      </p>
      {unfinished > 0 && (
        <FormField id="sprint-unfinished" label="Move unfinished tasks to" required>
          {(f) => (
            <Select {...f} value={choice} onChange={(e) => setChoice(e.target.value)}>
              <option value="" disabled>
                Choose…
              </option>
              <option value={BACKLOG}>The backlog</option>
              {planned.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          )}
        </FormField>
      )}
      <FormError>{close.error ? errorText(close.error, 'Could not close the sprint') : null}</FormError>
      <DialogFooter>
        <Button type="button" variant="outline" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" size="sm" loading={close.isPending} disabled={unfinished > 0 && choice === ''}>
          Close sprint
        </Button>
      </DialogFooter>
    </form>
  )
}
