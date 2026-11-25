import type { Task, TaskStatusCategory } from '@/api/tasks'

/**
 * ADR-127: pure helpers for the task hierarchy. The API returns a project's tasks flat;
 * these turn them into the indented, collapsible tree the Tasks tab and the task picker show.
 */

/** Depth-first order: every task directly after its parent, siblings by ID (creation order). */
export function orderTree(tasks: readonly Task[]): Task[] {
  const byParent = new Map<string | null, Task[]>()
  const ids = new Set(tasks.map((t) => t.id))
  for (const task of tasks) {
    // A parent outside the set (filtered out, or not visible) makes the task a root of this view.
    const key = task.parent_task_id && ids.has(task.parent_task_id) ? task.parent_task_id : null
    const list = byParent.get(key)
    if (list) list.push(task)
    else byParent.set(key, [task])
  }
  const sortKey = (t: Task) => t.display_id ?? t.created_at
  const out: Task[] = []
  const walk = (parent: string | null) => {
    const children = (byParent.get(parent) ?? []).slice().sort((a, b) => sortKey(a).localeCompare(sortKey(b)))
    for (const child of children) {
      out.push(child)
      walk(child.id)
    }
  }
  walk(null)
  return out
}

/** `ordered` (from `orderTree`) without the descendants of any collapsed task. */
export function visibleRows(ordered: readonly Task[], collapsed: ReadonlySet<string>): Task[] {
  const out: Task[] = []
  let hiddenBelow: number | null = null
  for (const task of ordered) {
    if (hiddenBelow !== null) {
      if (task.depth > hiddenBelow) continue
      hiddenBelow = null
    }
    out.push(task)
    if (collapsed.has(task.id)) hiddenBelow = task.depth
  }
  return out
}

/** Ids of every task below `id` (not `id` itself). */
export function descendantIds(tasks: readonly Task[], id: string): Set<string> {
  const children = new Map<string, string[]>()
  for (const task of tasks) {
    if (!task.parent_task_id) continue
    const list = children.get(task.parent_task_id)
    if (list) list.push(task.id)
    else children.set(task.parent_task_id, [task.id])
  }
  const out = new Set<string>()
  const stack = [...(children.get(id) ?? [])]
  while (stack.length > 0) {
    const next = stack.pop()!
    if (out.has(next)) continue
    out.add(next)
    stack.push(...(children.get(next) ?? []))
  }
  return out
}

/** How many levels the subtree under `id` adds below it (0 for a task without sub-tasks). */
export function subtreeHeight(tasks: readonly Task[], id: string): number {
  const below = descendantIds(tasks, id)
  const root = tasks.find((t) => t.id === id)
  if (!root) return 0
  let height = 0
  for (const task of tasks) if (below.has(task.id)) height = Math.max(height, task.depth - root.depth)
  return height
}

/** The deepest level a task may have (`MAX_TASK_DEPTH` on the server). */
export const MAX_TASK_DEPTH = 4

/**
 * Tasks a task may be moved under: not itself, not its own sub-tasks, and not so deep that its
 * subtree would pass the nesting limit. The server checks the same rules and stays authoritative.
 */
export function validParents(tasks: readonly Task[], movingId: string | null): Task[] {
  // The default task for requirements takes no sub-tasks (ADR-128).
  if (movingId === null) return tasks.filter((t) => t.depth < MAX_TASK_DEPTH && !t.is_requirements_home)
  const below = descendantIds(tasks, movingId)
  const height = subtreeHeight(tasks, movingId)
  return tasks.filter(
    (t) =>
      t.id !== movingId && !below.has(t.id) && !t.is_requirements_home && t.depth + 1 + height <= MAX_TASK_DEPTH,
  )
}

/** "TASK_000001 · Title" (just the title for a task without an id). */
export function taskLabel(task: { display_id: string | null; title: string }): string {
  return task.display_id ? `${task.display_id} · ${task.title}` : task.title
}

export function categoryTone(category: TaskStatusCategory): 'neutral' | 'info' | 'positive' {
  return category === 'done' ? 'positive' : category === 'in_progress' ? 'info' : 'neutral'
}

/** "2 of 5" for the sub-task progress column; null when there are no sub-tasks. */
export function subTaskProgress(task: Pick<Task, 'sub_task_count' | 'sub_tasks_done'>): string | null {
  return task.sub_task_count > 0 ? `${task.sub_tasks_done} of ${task.sub_task_count}` : null
}
