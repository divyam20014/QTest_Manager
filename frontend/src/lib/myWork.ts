import type { MyRunCase, MyRunCaseStatus, MyTask } from '@/api/myWork'
import type { Defect } from '@/api/defects'

/** The run-case groups on the My Work page, in the order they are shown. */
export const RUN_CASE_GROUPS: { status: MyRunCaseStatus; label: string; hint: string }[] = [
  { status: 'in_progress', label: 'In progress', hint: 'Started, not finished' },
  { status: 'failed', label: 'Failed - retest', hint: 'A step failed; run it again once fixed' },
  { status: 'blocked', label: 'Blocked', hint: 'Waiting on something' },
  { status: 'pending', label: 'Not run', hint: 'Assigned to you, not started' },
]

export function groupRunCases(items: MyRunCase[]): { status: MyRunCaseStatus; label: string; hint: string; items: MyRunCase[] }[] {
  return RUN_CASE_GROUPS.map((g) => ({ ...g, items: items.filter((i) => i.status === g.status) })).filter(
    (g) => g.items.length > 0,
  )
}

/** Overdue tasks apart from the rest; the API already orders each by due date. */
export function groupTasks(items: MyTask[]): { key: 'overdue' | 'open'; label: string; items: MyTask[] }[] {
  const groups = [
    { key: 'overdue' as const, label: 'Overdue', items: items.filter((t) => t.overdue) },
    { key: 'open' as const, label: 'To do', items: items.filter((t) => !t.overdue) },
  ]
  return groups.filter((g) => g.items.length > 0)
}

export interface MyDefect {
  defect: Defect
  /** Why it is here: assigned to me, reported by me, or both. */
  reason: 'assigned' | 'reported' | 'both'
}

/** Merge the "assigned to me" and "reported by me" lists (one row per defect), newest first. */
export function mergeMyDefects(assigned: Defect[], reported: Defect[]): MyDefect[] {
  const byId = new Map<string, MyDefect>()
  for (const defect of assigned) byId.set(defect.id, { defect, reason: 'assigned' })
  for (const defect of reported) {
    const existing = byId.get(defect.id)
    byId.set(defect.id, existing ? { defect, reason: 'both' } : { defect, reason: 'reported' })
  }
  return [...byId.values()].sort((a, b) => b.defect.created_at.localeCompare(a.defect.created_at))
}

export const MY_DEFECT_REASON_LABEL: Record<MyDefect['reason'], string> = {
  assigned: 'Assigned to me',
  reported: 'Reported by me',
  both: 'Assigned to me, reported by me',
}
