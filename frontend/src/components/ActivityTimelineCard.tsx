import type { HistoryEntry } from '@/api/history'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

// Per-entity activity timeline (PV-9.3): a read-only view over the
// hash-chained audit log, filtered to one entity. Shared across Test Case,
// Requirement, and Defect detail views -- distinct from version history,
// which only covers content edits.
export function ActivityTimelineCard({
  entries,
  actionLabels,
  renderDetail,
}: {
  entries: HistoryEntry[] | undefined
  actionLabels: Record<string, string>
  renderDetail?: (entry: HistoryEntry) => string | null
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Activity Timeline</CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="flex flex-col gap-2 text-sm">
          {(entries ?? []).length === 0 && (
            <li className="text-[var(--muted-foreground)]">No activity recorded.</li>
          )}
          {entries?.map((entry) => (
            <li key={entry.id} className="border-b border-[var(--border)] pb-2 last:border-0">
              <p className="font-medium">{actionLabels[entry.action] ?? entry.action}</p>
              <p className="text-xs text-[var(--muted-foreground)]">
                {entry.user_name ?? 'System'} · {new Date(entry.created_at).toLocaleString()}
                {renderDetail?.(entry)}
              </p>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}
