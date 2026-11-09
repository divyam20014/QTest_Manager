import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'

import { listAuditLogs, verifyAuditChain } from '@/api/audit'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

export function AuditLogs() {
  const [action, setAction] = useState('')
  const [entityType, setEntityType] = useState('')
  const [verifyRequested, setVerifyRequested] = useState(false)

  const logsQuery = useQuery({
    queryKey: ['audit-logs', action, entityType],
    queryFn: () => listAuditLogs({ action: action || undefined, entity_type: entityType || undefined }),
  })

  const verifyQuery = useQuery({
    queryKey: ['audit-logs', 'verify-chain'],
    queryFn: verifyAuditChain,
    enabled: verifyRequested,
  })

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">Audit Logs</h2>
        <Button
          variant="outline"
          size="sm"
          onClick={() => (verifyRequested ? verifyQuery.refetch() : setVerifyRequested(true))}
          disabled={verifyQuery.isFetching}
        >
          {verifyQuery.isFetching ? 'Verifying…' : 'Verify Chain Integrity'}
        </Button>
      </div>

      {verifyRequested && verifyQuery.data && (
        <div
          className={`rounded-md border p-3 text-xs ${
            verifyQuery.data.valid
              ? 'border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300'
              : 'border-red-300 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-300'
          }`}
        >
          {verifyQuery.data.valid
            ? `Chain verified: ${verifyQuery.data.checked_count} records, hashes consistent, no gaps (ADR-006).`
            : `Chain integrity FAILED at record ${verifyQuery.data.broken_at_id} — ${verifyQuery.data.checked_count} records checked.`}
        </div>
      )}

      <div className="flex flex-wrap gap-3">
        <Input
          aria-label="Filter by action"
          placeholder="Filter by action (e.g. user.created)"
          value={action}
          onChange={(e) => setAction(e.target.value)}
          className="w-64"
        />
        <Input
          aria-label="Filter by entity type"
          placeholder="Filter by entity type (e.g. project)"
          value={entityType}
          onChange={(e) => setEntityType(e.target.value)}
          className="w-64"
        />
      </div>

      <div className="overflow-hidden rounded-lg border border-[var(--border)]">
        <table className="w-full text-sm">
          <thead className="bg-[var(--muted)] text-left text-xs text-[var(--muted-foreground)]">
            <tr>
              <th className="px-4 py-2 font-medium">When</th>
              <th className="px-4 py-2 font-medium">User</th>
              <th className="px-4 py-2 font-medium">Action</th>
              <th className="px-4 py-2 font-medium">Entity</th>
              <th className="px-4 py-2 font-medium">Record Hash</th>
            </tr>
          </thead>
          <tbody>
            {logsQuery.data?.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-[var(--muted-foreground)]">
                  No audit entries found.
                </td>
              </tr>
            )}
            {logsQuery.data?.map((entry) => (
              <tr key={entry.id} className="border-t border-[var(--border)] hover:bg-[var(--muted)]">
                <td className="px-4 py-2 text-xs text-[var(--muted-foreground)]">
                  {new Date(entry.created_at).toLocaleString()}
                </td>
                <td className="px-4 py-2">{entry.user_name ?? 'System'}</td>
                <td className="px-4 py-2">
                  <Badge>{entry.action}</Badge>
                </td>
                <td className="px-4 py-2 text-xs text-[var(--muted-foreground)]">
                  {entry.entity_type} · {entry.entity_id.slice(0, 8)}
                </td>
                <td className="px-4 py-2 font-mono text-xs text-[var(--muted-foreground)]">
                  {entry.record_hash.slice(0, 12)}…
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
