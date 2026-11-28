// Phase 2: small planning rules shared by the task screens.

/** "2.50" -> "2.5 h"; nothing estimated is a dash. */
export function formatHours(hours: string | number | null | undefined): string {
  if (hours === null || hours === undefined || hours === '') return '—'
  return `${Number(hours)} h`
}

/** The sum of the estimates, and how many have none. */
export function totalHours(tasks: { estimate_hours?: string | null }[]): { hours: number; unestimated: number } {
  let cents = 0
  let unestimated = 0
  for (const t of tasks) {
    if (t.estimate_hours === null || t.estimate_hours === undefined) unestimated += 1
    else cents += Math.round(Number(t.estimate_hours) * 100)
  }
  return { hours: cents / 100, unestimated }
}

export type Move = 'top' | 'up' | 'down'

/**
 * What to send to move the item at `index`: the id to place it before (null = the end), or
 * undefined when the move is not possible, including when its new neighbour is not loaded.
 */
export function moveTarget(ids: string[], index: number, move: Move, hasMore: boolean): string | null | undefined {
  if (move === 'top') return index > 0 ? ids[0] : undefined
  if (move === 'up') return index > 0 ? ids[index - 1] : undefined
  if (index >= ids.length - 1) return undefined
  if (index + 2 < ids.length) return ids[index + 2]
  return hasMore ? undefined : null
}

/** Today in the viewer's own time zone, as the date fields write it (YYYY-MM-DD). */
export function localToday(now: Date = new Date()): string {
  const two = (n: number) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())}`
}

/** A date is past once the day itself is over. */
export function isPastDue(due: string | null, today: string): boolean {
  return due !== null && due < today
}

export function percentDone(done: number, total: number): number {
  return total === 0 ? 0 : Math.round((done / total) * 100)
}

export const SPRINT_STATE_LABEL = { planned: 'Planned', active: 'Active', closed: 'Closed' } as const

export type SprintFlag = { label: string; tone: 'info' | 'warning' | 'positive' | 'neutral' }

/** What happened to a task in a sprint, in words (never by colour alone). */
export function sprintFlags(
  task: { added_after_start: boolean; removed_at: string | null; done: boolean; deleted: boolean },
  state: 'planned' | 'active' | 'closed',
): SprintFlag[] {
  const flags: SprintFlag[] = []
  if (task.added_after_start) flags.push({ label: 'Added after start', tone: 'info' })
  if (task.removed_at) flags.push({ label: 'Removed', tone: 'neutral' })
  else if (task.done) flags.push({ label: 'Done', tone: 'positive' })
  else if (state === 'closed') flags.push({ label: 'Not done', tone: 'warning' })
  if (task.deleted) flags.push({ label: 'Task deleted', tone: 'neutral' })
  return flags
}

/** ADR-147: a reminder, never a refusal. */
export function dependencyWarning(open: number): string | null {
  if (open <= 0) return null
  return open === 1
    ? 'A task that should finish first is not done yet. You can still work on this one.'
    : `${open} tasks that should finish first are not done yet. You can still work on this one.`
}

/** The short form for lists and boards; nothing once the task itself is done. */
export function waitingLabel(task: { open_dependency_count?: number; status: { category: string } }): string | null {
  const open = task.open_dependency_count ?? 0
  return open > 0 && task.status.category !== 'done' ? `Waiting on ${open}` : null
}
