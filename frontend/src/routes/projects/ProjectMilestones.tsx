import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'

import { hasPermission } from '@/api/auth'
import { ApiError } from '@/api/client'
import { createMilestone, deleteMilestone, listMilestones, updateMilestone, type Milestone, type MilestoneUpdate } from '@/api/planning'
import { getProject } from '@/api/projects'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogFooter } from '@/components/ui/dialog'
import { ErrorState } from '@/components/ui/empty-state'
import { FormError, FormField } from '@/components/ui/form-field'
import { Input } from '@/components/ui/input'
import { DetailSkeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { useConfirm } from '@/components/ui/useConfirm'
import { useAuth } from '@/lib/auth'
import { formatHours, isPastDue, localToday, percentDone } from '@/lib/planning'
import { useToast } from '@/lib/toast'

const errorText = (err: unknown, fallback: string) => (err instanceof ApiError ? err.message : fallback)

// ADR-145: dated goals that tasks belong to.
export function MilestonesCard({ projectId }: { projectId: string }) {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const { show: showToast } = useToast()
  const { ask, dialog: confirmDialog } = useConfirm()
  const [name, setName] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [editing, setEditing] = useState<Milestone | null>(null)

  const project = useQuery({ queryKey: ['projects', projectId], queryFn: () => getProject(projectId) })
  const canManage = hasPermission(user, 'planning.manage') && !project.data?.archived_at
  const query = useQuery({ queryKey: ['milestones', projectId], queryFn: () => listMilestones(projectId) })

  function refresh() {
    queryClient.invalidateQueries({ queryKey: ['milestones', projectId] })
    queryClient.invalidateQueries({ queryKey: ['tasks'] })
  }

  const create = useMutation({
    mutationFn: () => createMilestone(projectId, { name: name.trim(), due_date: dueDate || null }),
    onSuccess: () => {
      setName('')
      setDueDate('')
      refresh()
      showToast('success', 'Milestone created')
    },
  })
  const change = useMutation({
    mutationFn: ({ id, req }: { id: string; req: MilestoneUpdate }) => updateMilestone(id, req),
    onSuccess: refresh,
    onError: (err) => showToast('error', errorText(err, 'Could not change the milestone')),
  })
  const remove = useMutation({
    mutationFn: (id: string) => deleteMilestone(id),
    onSuccess: () => {
      refresh()
      showToast('success', 'Milestone deleted')
    },
    onError: (err) => showToast('error', errorText(err, 'Could not delete the milestone')),
  })

  const today = localToday()

  return (
    <Card>
      {confirmDialog}
      <CardHeader>
        <CardTitle>Milestones</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        {query.isLoading ? (
          <DetailSkeleton />
        ) : query.isError ? (
          <ErrorState message="Could not load milestones." error={query.error} onRetry={() => query.refetch()} />
        ) : query.data?.length === 0 ? (
          <p className="text-[var(--muted-foreground)]">No milestones yet. A milestone is a dated goal that tasks belong to.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-[var(--border)]">
            {query.data?.map((m) => (
              <li key={m.id} className="flex flex-col gap-1.5 py-3 first:pt-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{m.name}</span>
                  {m.completed_at ? (
                    <Badge tone="positive">Completed</Badge>
                  ) : (
                    isPastDue(m.due_date, today) && <Badge tone="critical">Past due</Badge>
                  )}
                  <span className="text-[var(--muted-foreground)]">{m.due_date ? `Due ${m.due_date}` : 'No due date'}</span>
                </div>
                {m.description && <p className="whitespace-pre-wrap">{m.description}</p>}
                <progress
                  className="h-2 w-full"
                  max={100}
                  value={percentDone(m.done_count, m.task_count)}
                  aria-label={`${m.name}: tasks done`}
                />
                <p className="text-[var(--muted-foreground)]">
                  {m.done_count} of {m.task_count} task{m.task_count === 1 ? '' : 's'} done · {formatHours(m.done_estimate_hours)} of{' '}
                  {formatHours(m.estimate_hours)} estimated
                </p>
                <div className="flex flex-wrap gap-2">
                  <Link to={`/projects/${projectId}/tasks?view=flat&milestone=${m.id}`} className="self-center underline underline-offset-2">
                    View tasks
                  </Link>
                  {canManage && (
                    <>
                      <Button
                        variant="outline"
                        size="sm"
                        aria-label={`${m.completed_at ? 'Reopen' : 'Complete'} milestone ${m.name}`}
                        disabled={change.isPending}
                        onClick={() => {
                          const open = m.task_count - m.done_count
                          if (m.completed_at || open === 0) return change.mutate({ id: m.id, req: { completed: !m.completed_at } })
                          ask({
                            title: `Complete “${m.name}”?`,
                            description: `${open} of its tasks ${open === 1 ? 'is' : 'are'} not done. They stay in the milestone, and no new tasks can join it until it is reopened.`,
                            confirmLabel: 'Complete milestone',
                            destructive: false,
                            run: () => change.mutateAsync({ id: m.id, req: { completed: true } }),
                          })
                        }}
                      >
                        {m.completed_at ? 'Reopen' : 'Complete'}
                      </Button>
                      <Button variant="outline" size="sm" aria-label={`Edit milestone ${m.name}`} onClick={() => setEditing(m)}>
                        Edit
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={`Delete milestone ${m.name}`}
                        onClick={() =>
                          ask({
                            title: `Delete milestone “${m.name}”?`,
                            description: 'Its tasks are kept; they no longer belong to a milestone.',
                            confirmLabel: 'Delete milestone',
                            run: () => remove.mutateAsync(m.id),
                          })
                        }
                      >
                        Delete
                      </Button>
                    </>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}

        {canManage && (
          <form
            className="flex flex-col gap-2 border-t border-[var(--border)] pt-3"
            onSubmit={(e) => {
              e.preventDefault()
              create.mutate()
            }}
          >
            <div className="flex flex-wrap items-end gap-2">
              <div className="min-w-48 flex-1">
                <FormField id="milestone-name" label="New milestone">
                  {(f) => <Input {...f} value={name} maxLength={120} autoComplete="off" onChange={(e) => setName(e.target.value)} />}
                </FormField>
              </div>
              <FormField id="milestone-due" label="Due date (optional)">
                {(f) => <Input {...f} type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />}
              </FormField>
              <Button type="submit" size="sm" loading={create.isPending} disabled={name.trim().length < 2}>
                Add milestone
              </Button>
            </div>
            <FormError>{create.error ? errorText(create.error, 'Could not create the milestone') : null}</FormError>
          </form>
        )}
      </CardContent>
      <Dialog open={editing !== null} onClose={() => setEditing(null)} title="Edit milestone" className="max-w-lg">
        {editing && <MilestoneForm key={editing.id} milestone={editing} onDone={() => { setEditing(null); refresh() }} onCancel={() => setEditing(null)} />}
      </Dialog>
    </Card>
  )
}

function MilestoneForm({ milestone, onDone, onCancel }: { milestone: Milestone; onDone: () => void; onCancel: () => void }) {
  const [name, setName] = useState(milestone.name)
  const [description, setDescription] = useState(milestone.description ?? '')
  const [dueDate, setDueDate] = useState(milestone.due_date ?? '')
  const save = useMutation({
    mutationFn: () => updateMilestone(milestone.id, { name: name.trim(), description: description || null, due_date: dueDate || null }),
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
      <FormField id="edit-milestone-name" label="Name" required>
        {(f) => <Input {...f} value={name} maxLength={120} onChange={(e) => setName(e.target.value)} />}
      </FormField>
      <FormField id="edit-milestone-description" label="Description">
        {(f) => <Textarea {...f} rows={3} maxLength={5000} value={description} onChange={(e) => setDescription(e.target.value)} />}
      </FormField>
      <FormField id="edit-milestone-due" label="Due date">
        {(f) => <Input {...f} type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />}
      </FormField>
      <FormError>{save.error ? errorText(save.error, 'Could not save the milestone') : null}</FormError>
      <DialogFooter>
        <Button type="button" variant="outline" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" size="sm" loading={save.isPending} disabled={name.trim().length < 2}>
          Save milestone
        </Button>
      </DialogFooter>
    </form>
  )
}
