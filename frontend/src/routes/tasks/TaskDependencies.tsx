import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'

import { ApiError } from '@/api/client'
import { addTaskDependency, listTasks, removeTaskDependency, type TaskDependency, type TaskDetail } from '@/api/tasks'
import { TaskStatusBadge } from '@/components/TaskStatusBadge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { dependencyWarning } from '@/lib/planning'
import { useToast } from '@/lib/toast'
import { useDebouncedValue } from '@/lib/useDebouncedValue'

const MATCHES = 10

/** ADR-147: what should finish before this task, and what waits for it. A warning, not a lock. */
export function TaskDependencies({ task, canManage }: { task: TaskDetail; canManage: boolean }) {
  const queryClient = useQueryClient()
  const { show: showToast } = useToast()
  const [search, setSearch] = useState('')
  const needle = useDebouncedValue(search.trim(), 300)
  const dependsOn = task.depends_on ?? []
  const blocks = task.blocks ?? []
  const warning = task.status.category === 'done' ? null : dependencyWarning(task.open_dependency_count ?? 0)

  const matches = useQuery({
    queryKey: ['tasks', 'dependency-search', task.project_id, needle],
    queryFn: () => listTasks(task.project_id, { q: needle, page_size: MATCHES }),
    enabled: canManage && needle.length >= 2,
  })
  const linked = new Set([task.id, ...dependsOn.map((d) => d.task_id)])
  const choices = (matches.data?.items ?? []).filter((t) => !linked.has(t.id))

  const change = useMutation({
    mutationFn: ({ otherId, add }: { otherId: string; add: boolean }) =>
      add ? addTaskDependency(task.id, otherId) : removeTaskDependency(task.id, otherId),
    onSuccess: (_, { add }) => {
      if (add) setSearch('')
      void queryClient.invalidateQueries({ queryKey: ['tasks'] })
    },
    onError: (err) => showToast('error', err instanceof ApiError ? err.message : 'Could not change the dependency'),
  })

  if (!canManage && dependsOn.length === 0 && blocks.length === 0) return null

  return (
    <Card>
      <CardHeader>
        <CardTitle>Dependencies</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        {warning && (
          <p role="note" className="rounded-md bg-[var(--status-warning-bg)] px-3 py-2">
            {warning}
          </p>
        )}
        <DependencyList
          label="Must finish first"
          empty="This task does not wait for any other."
          projectId={task.project_id}
          items={dependsOn}
          busy={change.isPending}
          onRemove={canManage ? (id) => change.mutate({ otherId: id, add: false }) : undefined}
        />
        {blocks.length > 0 && (
          <DependencyList label="Waiting for this task" projectId={task.project_id} items={blocks} busy={false} />
        )}
        {canManage && (
          <div className="flex flex-col gap-1.5">
            <label htmlFor="dependency-search" className="text-xs font-medium text-[var(--muted-foreground)]">
              Add a task that must finish first
            </label>
            <Input
              id="dependency-search"
              placeholder="Search by title or ID"
              autoComplete="off"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {needle.length >= 2 && !matches.isLoading && (
              <>
                <p role="status" className="text-xs text-[var(--muted-foreground)]">
                  {matches.isError
                    ? 'The search failed.'
                    : choices.length === 0
                      ? 'No other task matches.'
                      : `${choices.length} match${choices.length === 1 ? '' : 'es'}${(matches.data?.total ?? 0) > MATCHES ? ', type more to narrow them' : ''}.`}
                </p>
                {choices.length > 0 && (
                  <ul aria-label="Matching tasks" className="flex flex-col gap-1">
                    {choices.map((t) => (
                      <li key={t.id} className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-xs">{t.display_id}</span>
                        <span className="min-w-0 flex-1 basis-40">{t.title}</span>
                        <TaskStatusBadge status={t.status} />
                        <Button
                          variant="outline"
                          size="sm"
                          aria-label={`Add ${t.title} as a dependency`}
                          disabled={change.isPending}
                          onClick={() => change.mutate({ otherId: t.id, add: true })}
                        >
                          Add
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function DependencyList({
  label,
  empty,
  projectId,
  items,
  busy,
  onRemove,
}: {
  label: string
  empty?: string
  projectId: string
  items: TaskDependency[]
  busy: boolean
  onRemove?: (taskId: string) => void
}) {
  return (
    <div className="flex flex-col gap-1">
      <h3 className="text-xs font-medium text-[var(--muted-foreground)]">{label}</h3>
      {items.length === 0 ? (
        <p className="text-[var(--muted-foreground)]">{empty}</p>
      ) : (
        <ul aria-label={label} className="flex flex-col gap-1">
          {items.map((d) => (
            <li key={d.task_id} className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-xs">{d.display_id}</span>
              <Link to={`/projects/${projectId}/tasks/${d.task_id}`} className="min-w-0 flex-1 basis-40 underline-offset-2 hover:underline">
                {d.title}
              </Link>
              <TaskStatusBadge status={d.status} />
              {onRemove && (
                <Button variant="ghost" size="sm" aria-label={`Remove the dependency on ${d.title}`} disabled={busy} onClick={() => onRemove(d.task_id)}>
                  Remove
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
