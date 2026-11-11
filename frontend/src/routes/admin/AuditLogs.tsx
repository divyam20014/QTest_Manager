import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'

import { auditExportUrl, listAuditLogs, verifyAuditChain, type AuditLogEntry } from '@/api/audit'
import { listUsers } from '@/api/users'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { DateRangePicker } from '@/components/ui/date-range-picker'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { humanizeActionCode, humanizeKey } from '@/lib/labels'
import { useUrlFilters } from '@/lib/useUrlFilters'

// GAP-91 item 2: URL-persisted filters + chips, same pattern as
// Test Cases/Defects. No pagination exists on `GET /audit-logs` today
// (it returns the full filtered array) -- adding server-side pagination
// is a backend change out of scope for this frontend rollout, noted
// rather than silently worked around. No bulk actions apply (a read-only
// log) and no column-picker (the audit schema's columns are fixed), so
// neither is added here. Sort is already fixed (newest first) server-side.
export function AuditLogs() {
  const filterDefaults = { action: '', entityType: '', entityId: '', userId: '', dateFrom: '', dateTo: '' }
  const urlFilters = useUrlFilters(filterDefaults)
  const action = urlFilters.values.action
  const entityType = urlFilters.values.entityType
  const entityId = urlFilters.values.entityId
  const userId = urlFilters.values.userId
  const dateFrom = urlFilters.values.dateFrom
  const dateTo = urlFilters.values.dateTo
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

  const FILTER_CHIP_LABEL: Record<string, string> = {
    action: 'Action',
    entityType: 'Entity type',
    entityId: 'Entity ID',
    userId: 'User',
    dateFrom: 'From',
    dateTo: 'To',
  }
  const chipDisplayValue: Record<string, string> = {
    userId: usersQuery.data?.find((u) => u.id === userId)?.name ?? userId,
  }
  const visibleFilterChips = urlFilters.active.filter((key) => key in FILTER_CHIP_LABEL)

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
          onChange={(e) => urlFilters.setFilter('action', e.target.value)}
          className="w-56"
        />
        <Input
          aria-label="Filter by entity type"
          placeholder="Filter by entity type (e.g. project)"
          value={entityType}
          onChange={(e) => urlFilters.setFilter('entityType', e.target.value)}
          className="w-56"
        />
        <Input
          aria-label="Filter by entity ID"
          placeholder="Filter by entity ID"
          value={entityId}
          onChange={(e) => urlFilters.setFilter('entityId', e.target.value)}
          className="w-56"
        />
        <Select
          aria-label="Filter by user"
          value={userId}
          onChange={(e) => urlFilters.setFilter('userId', e.target.value)}
          className="w-48"
        >
          <option value="">All users</option>
          {usersQuery.data?.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </Select>
        <DateRangePicker
          idPrefix="audit-date"
          fromValue={dateFrom}
          toValue={dateTo}
          onChange={(from, to) => urlFilters.setFilters({ dateFrom: from, dateTo: to })}
        />
        {urlFilters.active.length > 0 && (
          <Button variant="outline" size="sm" onClick={urlFilters.clearAll}>
            Clear filters
          </Button>
        )}
      </div>

      {visibleFilterChips.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {visibleFilterChips.map((key) => (
            <span
              key={key}
              className="inline-flex items-center gap-1 rounded-full bg-[var(--muted)] px-2.5 py-1 text-xs"
            >
              {FILTER_CHIP_LABEL[key]}: {chipDisplayValue[key] ?? urlFilters.values[key]}
              <button
                type="button"
                onClick={() => urlFilters.setFilter(key, '')}
                aria-label={`Remove ${FILTER_CHIP_LABEL[key]} filter`}
                className="text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}

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
          <Badge title={entry.action}>{humanizeActionCode(entry.action)}</Badge>
        </td>
        <td className="px-4 py-2 text-xs text-[var(--muted-foreground)]">
          {humanizeKey(entry.entity_type)} · {entry.entity_id.slice(0, 8)}
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
