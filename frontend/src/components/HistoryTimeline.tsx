import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { formatChange, type TimelineEntry } from '@/lib/historyChanges'
import { humanizeActionCode } from '@/lib/labels'

/**
 * Audit timeline of one record (test case, defect): what happened, who did it and when, with the
 * old and new value of every changed field. A strike-through plus an arrow and a screen-reader
 * "changed to", so the before / after reading never depends on the line style alone.
 */
export function HistoryTimeline({
  entries,
  labels = {},
  title = 'History',
  empty = 'No activity recorded.',
}: {
  entries: TimelineEntry[] | undefined
  labels?: Record<string, string>
  title?: string
  empty?: string
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="flex flex-col gap-3 text-sm">
          {(entries ?? []).length === 0 && <li className="text-[var(--muted-foreground)]">{empty}</li>}
          {entries?.map((entry) => {
            const rows = entry.changes ? Object.entries(entry.changes) : []
            return (
              <li key={entry.id} className="border-b border-[var(--border)] pb-3 last:border-0">
                <p className="font-medium">{labels[entry.action] ?? humanizeActionCode(entry.action)}</p>
                <p className="text-xs text-[var(--muted-foreground)]">
                  {entry.user_name ?? 'System'} · {new Date(entry.created_at).toLocaleString()}
                </p>
                {rows.length > 0 && (
                  <dl className="mt-1.5 flex flex-col gap-1 text-xs">
                    {rows.map(([field, change]) => (
                      <div key={field} className="flex flex-wrap gap-x-2">
                        <dt className="font-medium">{humanizeActionCode(field)}:</dt>
                        <dd className="min-w-0 break-words">
                          <span className="text-[var(--muted-foreground)] line-through">{formatChange(change?.from)}</span>
                          <span aria-hidden="true"> → </span>
                          <span className="sr-only"> changed to </span>
                          <span>{formatChange(change?.to)}</span>
                        </dd>
                      </div>
                    ))}
                  </dl>
                )}
              </li>
            )
          })}
        </ul>
      </CardContent>
    </Card>
  )
}
