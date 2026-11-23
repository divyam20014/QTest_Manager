export interface TimelineEntry {
  id: string
  action: string
  user_name: string | null
  created_at: string
  /** `{field: {from, to}}`, shown as before -> after. */
  changes?: Record<string, { from: unknown; to: unknown }> | null
}

/** The changes recorded on an audit event's metadata (`metadata.changes`), when it has any. */
export function changesOf(metadata: Record<string, unknown> | undefined): TimelineEntry['changes'] {
  const changes = metadata?.changes
  return changes && typeof changes === 'object' ? (changes as Record<string, { from: unknown; to: unknown }>) : null
}

/** Display text of one side of a change. */
export function formatChange(value: unknown): string {
  if (value === null || value === undefined || value === '') return '(empty)'
  return typeof value === 'string' ? value : JSON.stringify(value)
}
