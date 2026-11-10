import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'

import { auditExportUrl, listAuditLogs, verifyAuditChain, type AuditLogEntry } from '@/api/audit'
import { listUsers } from '@/api/users'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'

export function AuditLogs() {
  const [action, setAction] = useState('')
  const [entityType, setEntityType] = useState('')
  const [entityId, setEntityId] = useState('')
  const [userId, setUserId] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [verifyRequested, setVerifyRequested] = useState(false)

  const usersQuery = useQuery({ queryKey: ['users'], queryFn: listUsers })

  const filters = {
    action: action || undefined,
    entity_type: entityType || undefined,
    entity_id: entityId || undefined,
    user_id: userId || undefined,
    date_from: dateFrom ? new Date(dateFrom).toISOString() : undefined,
    date_to: dateTo ? new Date(dateTo).toISOString() : undefined,
  }

  const logsQuery = useQuery({
    queryKey: ['audit-logs', filters],
    queryFn: () => listAuditLogs(filters),
  })

  const verifyQuery = useQuery({
    queryKey: ['audit-logs', 'verify-chain'],
    queryFn: verifyAuditChain,
    enabled: verifyRequested,
  })

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Audit Logs</h1>
        <div className="flex gap-2">
          <a
            href={auditExportUrl(filters)}
            download
            className="inline-flex h-8 items-center rounded-md border border-[var(--border)] px-3 text-sm hover:bg-[var(--muted)]"
          >
            Export CSV
          </a>
          <Button
            variant="outline"
            size="sm"
            onClick={() => (verifyRequested ? verifyQuery.refetch() : setVerifyRequested(true))}
            disabled={verifyQuery.isFetching}
          >
            {verifyQuery.isFetching ? 'Verifying…' : 'Verify Chain Integrity'}
          </Button>
        </div>
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
          className="w-56"
        />
        <Input
          aria-label="Filter by entity type"
          placeholder="Filter by entity type (e.g. project)"
          value={entityType}
          onChange={(e) => setEntityType(e.target.value)}
          className="w-56"
        />
        <Input
          aria-label="Filter by entity ID"
          placeholder="Filter by entity ID"
          value={entityId}
          onChange={(e) => setEntityId(e.target.value)}
          className="w-56"
        />
        <Select aria-label="Filter by user" value={userId} onChange={(e) => setUserId(e.target.value)} className="w-48">
          <option value="">All users</option>
          {usersQuery.data?.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </Select>
        <Input
          aria-label="Date from"
          type="date"
          value={dateFrom}
          onChange={(e) => setDateFrom(e.target.value)}
          className="w-40"
        />
        <Input
          aria-label="Date to"
          type="date"
          value={dateTo}
          onChange={(e) => setDateTo(e.target.value)}
          className="w-40"
        />
      </div>

      <div className="overflow-x-auto rounded-lg border border-[var(--border)]">
        <table className="w-full text-sm">
          <thead className="bg-[var(--muted)] text-left text-xs text-[var(--muted-foreground)]">
            <tr>
              <th className="px-4 py-2 font-medium">When</th>
              <th className="px-4 py-2 font-medium">User</th>
              <th className="px-4 py-2 font-medium">Action</th>
              <th className="px-4 py-2 font-medium">Entity</th>
              <th className="px-4 py-2 font-medium">Record Hash</th>
              <th className="px-4 py-2 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {logsQuery.data?.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-[var(--muted-foreground)]">
                  No audit entries found.
                </td>
              </tr>
            )}
            {logsQuery.data?.map((entry) => (
              <AuditRow
                key={entry.id}
                entry={entry}
                expanded={expandedId === entry.id}
                onToggle={() => setExpandedId(expandedId === entry.id ? null : entry.id)}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function AuditRow({
  entry,
  expanded,
  onToggle,
}: {
  entry: AuditLogEntry
  expanded: boolean
  onToggle: () => void
}) {
  return (
    <>
      <tr className="border-t border-[var(--border)] hover:bg-[var(--muted)]">
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
        <td className="px-4 py-2 text-right text-xs">
          {/* aria-expanded is only valid on treegrid rows, not plain
              <tr> (axe: aria-conditional-attr) -- it belongs on the
              actual interactive control, which also makes this
              keyboard-operable where the old click-anywhere-on-the-row
              pattern was not. */}
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={expanded}
            className="text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:underline"
          >
            {expanded ? 'Hide' : 'Details'}
          </button>
        </td>
      </tr>
      {expanded && (
        <tr className="border-t border-[var(--border)] bg-[var(--muted)]">
          <td colSpan={6} className="px-4 py-3">
            <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-xs sm:grid-cols-2">
              <div>
                <dt className="text-[var(--muted-foreground)]">Audit ID</dt>
                <dd className="font-mono">{entry.id}</dd>
              </div>
              <div>
                <dt className="text-[var(--muted-foreground)]">Tenant ID</dt>
                <dd className="font-mono">{entry.tenant_id}</dd>
              </div>
              <div>
                <dt className="text-[var(--muted-foreground)]">Entity ID</dt>
                <dd className="font-mono">{entry.entity_id}</dd>
              </div>
              <div>
                <dt className="text-[var(--muted-foreground)]">User ID</dt>
                <dd className="font-mono">{entry.user_id ?? '—'}</dd>
              </div>
              <div>
                <dt className="text-[var(--muted-foreground)]">Previous Hash</dt>
                <dd className="break-all font-mono">{entry.prev_hash}</dd>
              </div>
              <div>
                <dt className="text-[var(--muted-foreground)]">Record Hash</dt>
                <dd className="break-all font-mono">{entry.record_hash}</dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-[var(--muted-foreground)]">Metadata</dt>
                <dd>
                  {entry.metadata ? (
                    <pre className="mt-1 overflow-x-auto rounded-md border border-[var(--border)] bg-[var(--background)] p-2 font-mono">
                      {JSON.stringify(entry.metadata, null, 2)}
                    </pre>
                  ) : (
                    <span className="text-[var(--muted-foreground)]">—</span>
                  )}
                </dd>
              </div>
            </dl>
          </td>
        </tr>
      )}
    </>
  )
}
