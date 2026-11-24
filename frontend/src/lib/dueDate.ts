// ADR-123: run-case due dates are plain calendar dates (YYYY-MM-DD). "Today" is the UTC date, the
// same one the API uses for its overdue figures, so a badge here never disagrees with a count there.

export function todayIso(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10)
}

/** A run case is overdue when its due date has passed and it has not been executed yet. */
export function isOverdue(
  due: string | null | undefined,
  status: string,
  today: string = todayIso(),
): boolean {
  return !!due && due < today && (status === 'pending' || status === 'in_progress')
}

/** Whole days from `today` to `due` (negative once it is past). */
export function daysUntil(due: string, today: string = todayIso()): number {
  const ms = Date.parse(`${due}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)
  return Math.round(ms / 86_400_000)
}

/** "Due 12 Mar 2026" style label; never throws on a malformed value. */
export function formatDueDate(due: string): string {
  const d = new Date(`${due}T00:00:00Z`)
  if (Number.isNaN(d.getTime())) return due
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
}

/** Short relative text for lists: "3 days overdue", "Due today", "Due in 5 days". */
export function dueRelative(due: string, today: string = todayIso()): string {
  const n = daysUntil(due, today)
  if (n === 0) return 'Due today'
  if (n === 1) return 'Due tomorrow'
  if (n > 1) return `Due in ${n} days`
  return n === -1 ? '1 day overdue' : `${-n} days overdue`
}
