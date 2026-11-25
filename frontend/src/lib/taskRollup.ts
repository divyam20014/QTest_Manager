import type { BadgeTone } from '@/components/ui/badge'
import type { TaskRollup, TaskTestCaseRow } from '@/api/tasks'

/** Whole-number percentage; 0 when there is nothing to divide by. */
export function percent(part: number, whole: number): number {
  return whole > 0 ? Math.round((100 * part) / whole) : 0
}

/** Requirement coverage as shown on a task: null when it has no requirements. */
export function coveragePercent(rollup: Pick<TaskRollup, 'requirements_total' | 'requirements_covered'>): number | null {
  return rollup.requirements_total > 0 ? percent(rollup.requirements_covered, rollup.requirements_total) : null
}

export type Health = 'good' | 'warning' | 'critical' | 'idle'

/**
 * One word for how a task is going, derived only from the numbers beside it (never estimated):
 *  - critical: a critical defect is open, or a linked test case last failed;
 *  - warning:  something is overdue, a defect is open, a requirement has no test case, or a case is blocked;
 *  - good:     there is work or results and none of the above;
 *  - idle:     nothing linked yet.
 */
export function taskHealth(r: TaskRollup): Health {
  if (r.defects_critical_open > 0 || r.test_cases_failed > 0) return 'critical'
  if (
    r.sub_tasks_overdue > 0 ||
    r.defects_open > 0 ||
    r.test_cases_blocked > 0 ||
    r.requirements_covered < r.requirements_total
  ) {
    return 'warning'
  }
  const empty =
    r.sub_tasks_total === 0 && r.requirements_total === 0 && r.test_cases_total === 0 && r.defects_total === 0
  return empty ? 'idle' : 'good'
}

export const HEALTH_LABEL: Record<Health, string> = {
  good: 'On track',
  warning: 'Needs attention',
  critical: 'At risk',
  idle: 'Nothing linked yet',
}

export const HEALTH_TONE: Record<Health, BadgeTone> = {
  good: 'positive',
  warning: 'warning',
  critical: 'critical',
  idle: 'neutral',
}

export function resultTone(result: TaskTestCaseRow['last_result']): BadgeTone {
  return result === 'passed' ? 'positive' : result === 'failed' ? 'critical' : result === 'blocked' ? 'warning' : 'neutral'
}

export function resultLabel(result: TaskTestCaseRow['last_result']): string {
  return result === 'passed' ? 'Passed' : result === 'failed' ? 'Failed' : result === 'blocked' ? 'Blocked' : 'Not run'
}

/** "Linked", "Via requirement" or both, for the source column of a task's test cases. */
export function caseSource(row: Pick<TaskTestCaseRow, 'linked_directly' | 'via_requirement'>): string[] {
  const out: string[] = []
  if (row.linked_directly) out.push('Linked')
  if (row.via_requirement) out.push('Via requirement')
  return out
}
