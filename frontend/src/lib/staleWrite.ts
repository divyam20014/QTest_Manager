// ADR-136: what an edit form does when someone else saved the record first.
import { ApiError } from '@/api/client'

/** The API refused a save made from an out-of-date copy. */
export function isStaleWrite(error: unknown): boolean {
  return error instanceof ApiError && error.code === 'stale_write'
}

/** Form values compared by content: `key` on a step row is only the client's identity for it. */
function same(a: unknown, b: unknown): boolean {
  const plain = (v: unknown) => JSON.stringify(v, (k, x) => (k === 'key' ? undefined : x))
  return plain(a) === plain(b)
}

export interface Rebased<T> {
  values: T
  /** Fields the user and someone else both changed, differently. The user's entry is kept. */
  bothChanged: (keyof T)[]
}

/**
 * Moves unsaved entries onto the latest saved copy: a field the user changed keeps their
 * entry, every other field takes the latest value. Without this, saving again would
 * restore whatever the form was opened with.
 */
export function rebaseValues<T extends object>(mine: T, opened: T, latest: T): Rebased<T> {
  const values = { ...latest }
  const bothChanged: (keyof T)[] = []
  for (const key of Object.keys(mine) as (keyof T)[]) {
    if (same(mine[key], opened[key])) continue
    values[key] = mine[key]
    if (!same(latest[key], opened[key]) && !same(latest[key], mine[key])) bothChanged.push(key)
  }
  return { values, bothChanged }
}

const LABELS: Record<string, string> = {
  module_id: 'Module',
  task_id: 'Task',
  assignee_id: 'Assignee',
  assigned_to: 'Assignee',
  test_case_ids: 'Linked test cases',
  requirement_ref: 'Requirement / User Story ID',
  steps: 'Steps',
}

export function fieldLabel(key: string): string {
  const text = key.replace(/_/g, ' ')
  return LABELS[key] ?? text.charAt(0).toUpperCase() + text.slice(1)
}
