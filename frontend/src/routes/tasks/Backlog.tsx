import { ArrowDown, ArrowUp, ChevronsUp } from 'lucide-react'
import { useState } from 'react'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'

import { ApiError } from '@/api/client'
import { getBacklog, listSprints, MAX_BACKLOG_PAGE, moveInBacklog, setTaskSprint } from '@/api/planning'
import { TaskStatusBadge } from '@/components/TaskStatusBadge'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { EmptyState, ErrorState } from '@/components/ui/empty-state'
import { Select } from '@/components/ui/select'
import { DetailSkeleton } from '@/components/ui/skeleton'
import { formatHours, moveTarget, totalHours, waitingLabel, type Move } from '@/lib/planning'
import { useToast } from '@/lib/toast'

const PAGE = 200
const MOVES: { move: Move; label: string; Icon: typeof ArrowUp }[] = [
  { move: 'top', label: 'to the top', Icon: ChevronsUp },
  { move: 'up', label: 'up', Icon: ArrowUp },
  { move: 'down', label: 'down', Icon: ArrowDown },
]

/** ADR-144: the project's open, unplanned tasks in the one order everyone sees. */
export function Backlog({ projectId, canReorder, canPlan = false }: { projectId: string; canReorder: boolean; canPlan?: boolean }) {
  const queryClient = useQueryClient()
  const { show: showToast } = useToast()
  const [limit, setLimit] = useState(PAGE)
  const [announcement, setAnnouncement] = useState('')
  const query = useQuery({
    queryKey: ['tasks', 'backlog', projectId, limit],
    queryFn: () => getBacklog(projectId, limit),
    placeholderData: keepPreviousData,
  })

  const sprints = useQuery({ queryKey: ['sprints', projectId], queryFn: () => listSprints(projectId), enabled: canPlan })
  const openSprints = (sprints.data ?? []).filter((s) => s.state !== 'closed')

  const plan = useMutation({
    mutationFn: ({ taskId, sprintId }: { taskId: string; sprintId: string; message: string }) => setTaskSprint(taskId, sprintId),
    onSuccess: async (_, { message }) => {
      await queryClient.invalidateQueries({ queryKey: ['tasks'] })
      void queryClient.invalidateQueries({ queryKey: ['sprints', projectId] })
      void queryClient.invalidateQueries({ queryKey: ['sprint'] })
      setAnnouncement(message)
    },
    onError: (err) => showToast('error', err instanceof ApiError ? err.message : 'Could not add the task to the sprint'),
  })

  const move = useMutation({
    mutationFn: ({ taskId, before }: { taskId: string; before: string | null; message: string }) =>
      moveInBacklog(taskId, before),
    onSuccess: async (_, { message }) => {
      await queryClient.invalidateQueries({ queryKey: ['tasks', 'backlog', projectId] })
      setAnnouncement(message)
    },
    onError: (err) => {
      showToast('error', err instanceof ApiError ? err.message : 'Could not move the task')
      void queryClient.invalidateQueries({ queryKey: ['tasks', 'backlog', projectId] })
    },
  })

  if (query.isLoading) return <DetailSkeleton />
  if (query.isError) return <ErrorState message="Could not load the backlog." error={query.error} onRetry={() => query.refetch()} />
  const items = query.data?.items ?? []
  const total = query.data?.total ?? 0
  if (items.length === 0)
    return <EmptyState title="The backlog is empty" description="Open tasks that are not planned yet appear here, in priority order." />
  const hasMore = total > items.length
  const ids = items.map((t) => t.id)
  const sum = totalHours(items)

  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-[var(--muted-foreground)]">
        {total} open task{total === 1 ? '' : 's'}. Shown: {formatHours(sum.hours)} estimated
        {sum.unestimated > 0 && `, ${sum.unestimated} without an estimate`}. The order is the same for everyone.
      </p>
      <p role="status" className="sr-only">
        {announcement}
      </p>
      <ol aria-label="Backlog" className="flex flex-col divide-y divide-[var(--border)] rounded-xl border border-[var(--border)]">
        {items.map((t, index) => (
          <li key={t.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm">
            <span className="w-8 shrink-0 text-right tabular-nums text-[var(--muted-foreground)]">{index + 1}</span>
            <span className="shrink-0 font-mono text-xs">{t.display_id}</span>
            <Link to={`/projects/${projectId}/tasks/${t.id}`} className="min-w-0 flex-1 basis-48 font-medium underline-offset-2 hover:underline">
              {t.title}
            </Link>
            <Badge tone="info">{t.task_type}</Badge>
            {waitingLabel(t) && <Badge tone="warning">{waitingLabel(t)}</Badge>}
            <TaskStatusBadge status={t.status} />
            <span className="w-16 shrink-0 text-right tabular-nums" title="Estimate">
              {formatHours(t.estimate_hours)}
            </span>
            <span className="w-32 shrink-0 truncate text-[var(--muted-foreground)]">{t.assignee_name ?? 'Unassigned'}</span>
            {openSprints.length > 0 && !t.is_requirements_home && (
              <span className="w-40 shrink-0">
                <Select
                  aria-label={`Add ${t.title} to a sprint`}
                  value=""
                  disabled={plan.isPending}
                  onChange={(e) => {
                    const sprint = openSprints.find((s) => s.id === e.target.value)
                    if (sprint) plan.mutate({ taskId: t.id, sprintId: sprint.id, message: `${t.title} added to ${sprint.name}` })
                  }}
                >
                  <option value="">Add to sprint…</option>
                  {openSprints.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                      {s.state === 'active' ? ' (active)' : ''}
                    </option>
                  ))}
                </Select>
              </span>
            )}
            {canReorder && (
              <span className="flex shrink-0 gap-1">
                {MOVES.map(({ move: direction, label, Icon }) => {
                  const before = moveTarget(ids, index, direction, hasMore)
                  return (
                    <Button
                      key={direction}
                      variant="ghost"
                      size="sm"
                      className="px-2 max-md:min-h-11 max-md:min-w-11"
                      aria-label={`Move ${t.title} ${label}`}
                      disabled={before === undefined || move.isPending}
                      onClick={() =>
                        before !== undefined && move.mutate({ taskId: t.id, before, message: `${t.title} moved ${label}` })
                      }
                    >
                      <Icon className="size-4" aria-hidden="true" />
                    </Button>
                  )
                })}
              </span>
            )}
          </li>
        ))}
      </ol>
      {hasMore &&
        (limit < MAX_BACKLOG_PAGE ? (
          <Button variant="outline" size="sm" className="self-start" onClick={() => setLimit(Math.min(limit + PAGE, MAX_BACKLOG_PAGE))}>
            Show more
          </Button>
        ) : (
          <p role="note" className="text-xs text-[var(--muted-foreground)]">
            Showing the first {items.length} of {total} tasks.
          </p>
        ))}
    </div>
  )
}
