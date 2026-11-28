import { useQueryClient } from '@tanstack/react-query'
import { useMemo } from 'react'

import { ApiError } from '@/api/client'
import { changeTaskStatus, listTasks, type Task, type TaskStatus } from '@/api/tasks'
import { BoardView, type BoardCardData, type MoveOutcome } from '@/components/list/BoardView'
import { useBoardColumns, type BoardColumnState } from '@/lib/board'
import { waitingLabel } from '@/lib/planning'
import { levelTone } from '@/lib/statusTones'
import { subTaskProgress } from '@/lib/taskTree'

const PAGE_SIZE = 20

/**
 * Tasks by status (ADR-124 pattern). Each column is the task list filtered to one status, so its count is
 * the server's. Moving a card calls the real status endpoint: its refusals (a task with open sub-tasks
 * cannot be completed, a done parent cannot be reopened through its child) are shown and the card stays.
 * A person without `task.manage` can move only the tasks assigned to them.
 */
export function TasksBoard({
  projectId,
  statuses,
  scope,
  canManage,
  canTransition,
  userId,
}: {
  projectId: string
  statuses: TaskStatus[]
  /** The list's filters except the status. */
  scope: { q?: string; assignee_id?: string; sprint_id?: string }
  canManage: boolean
  canTransition: boolean
  userId: string | undefined
}) {
  const queryClient = useQueryClient()
  const columns = useMemo(() => statuses.map((s) => ({ id: s.id, label: s.label })), [statuses])
  const data = useBoardColumns<Task>({
    rootKey: ['tasks', 'board'],
    scope: { projectId, ...scope },
    columns,
    pageSize: PAGE_SIZE,
    enabled: statuses.length > 0,
    fetchPage: (statusId, page, pageSize) =>
      listTasks(projectId, { ...scope, status_id: statusId, page, page_size: pageSize }),
  })

  const tasks = new Map<string, Task>()
  const cards: Record<string, BoardColumnState<BoardCardData>> = {}
  for (const column of columns) {
    const state = data[column.id]
    if (!state) continue
    cards[column.id] = {
      ...state,
      items: state.items.map((t) => {
        tasks.set(t.id, t)
        return toCard(t, columns, canManage || (canTransition && t.assignee_id === userId))
      }),
    }
  }

  async function onMove(card: BoardCardData, to: string): Promise<MoveOutcome> {
    try {
      await changeTaskStatus(card.id, to)
    } catch (err) {
      throw new Error(err instanceof ApiError ? err.message : 'Could not change the status. Try again.')
    }
    void queryClient.invalidateQueries({ queryKey: ['tasks'] })
    return 'moved'
  }

  return (
    <BoardView
      label="Tasks board"
      noun="task"
      columns={columns}
      data={cards}
      onMove={canManage || canTransition ? onMove : undefined}
      explainBlocked={(card) => {
        const task = tasks.get(card.id)
        return task && !(canManage || task.assignee_id === userId)
          ? 'Only the assignee or a manager can move this task.'
          : 'This task cannot move there.'
      }}
      emptyText={(c) => `No tasks in ${c.label}.`}
    />
  )
}

function toCard(
  t: Task,
  columns: { id: string; label: string }[],
  movable: boolean,
): BoardCardData {
  const progress = subTaskProgress(t)
  const waiting = waitingLabel(t)
  const badges: NonNullable<BoardCardData['badges']> = []
  if (waiting) badges.push({ label: waiting, tone: 'warning' })
  if (progress) badges.push({ label: `${progress} sub-tasks done` })
  return {
    id: t.id,
    displayId: t.display_id,
    title: t.title,
    href: `/projects/${t.project_id}/tasks/${t.id}`,
    levels: [{ label: `${t.priority} priority`, tone: levelTone(t.priority) }],
    badges: badges.length > 0 ? badges : undefined,
    assignee: t.assignee_name,
    due: t.due_date ? { iso: t.due_date, overdue: t.is_overdue } : null,
    meta: t.depth > 0 ? 'Sub-task' : null,
    targets: movable
      ? columns.filter((c) => c.id !== t.status.id).map((c) => ({ column: c.id, label: c.label }))
      : [],
  }
}
