import { useState } from 'react'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'

import { AUDIT_PAGE_SIZE, auditExportUrl, listAuditLogs, verifyAuditChain, type AuditLogEntry } from '@/api/audit'
import { listUsers } from '@/api/users'
import { FilterBar, FilterField } from '@/components/table/FilterBar'
import { Badge } from '@/components/ui/badge'
import { Button, buttonVariants } from '@/components/ui/button'
import { Tooltip } from '@/components/ui/tooltip'
import { DateRangePicker } from '@/components/ui/date-range-picker'
import { ErrorState } from '@/components/ui/empty-state'
import { Skeleton } from '@/components/ui/skeleton'
import { Input } from '@/components/ui/input'
import { PageHeader } from '@/components/ui/PageHeader'
import { Select } from '@/components/ui/select'
import { humanizeActionCode, humanizeKey } from '@/lib/labels'
import { useIsMobile } from '@/lib/useMediaQuery'
import { useUrlFilters } from '@/lib/useUrlFilters'
import { useCanListUsers } from '@/lib/useCanListUsers'

// GAP-91 item 2: URL-persisted filters + chips, same pattern as
// Test Cases/Defects. `GET /audit-logs` is limit/offset paginated
// (default 50, max 200), so the list loads 50 at a time with a "Load more"
// button instead of silently stopping at the first page. No bulk actions apply (a read-only
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
  const isMobile = useIsMobile()

  const canListUsers = useCanListUsers()
  const usersQuery = useQuery({ queryKey: ['users'], queryFn: listUsers, enabled: canListUsers })

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

  const logsQuery = useInfiniteQuery({
    queryKey: ['audit-logs', filters],
    initialPageParam: 0,
    queryFn: ({ pageParam }) =>
      listAuditLogs(filters, { limit: AUDIT_PAGE_SIZE, offset: pageParam }),
    getNextPageParam: (lastPage, allPages) =>
      lastPage.length < AUDIT_PAGE_SIZE ? undefined : allPages.length * AUDIT_PAGE_SIZE,
  })
  const entries = logsQuery.data?.pages.flat()

  const verifyQuery = useQuery({
    queryKey: ['audit-logs', 'verify-chain'],
    queryFn: verifyAuditChain,
    enabled: verifyRequested,
  })

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Audit Logs"
        actions={
          <>
            <a
              href={auditExportUrl(filters)}
              download
              className={buttonVariants({ variant: 'outline', size: 'sm' })}
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
          </>
        }
      />

      {verifyRequested && verifyQuery.data && (
        <div
          role={verifyQuery.data.valid ? 'status' : 'alert'}
          className={`rounded-md border p-3 text-xs ${
            verifyQuery.data.valid
              ? 'border-[var(--status-good)] bg-[var(--status-good-bg)] text-[var(--status-good)]'
              : 'border-[var(--status-serious)] bg-[var(--status-serious-bg)] text-[var(--status-serious)]'
          }`}
        >
          {verifyQuery.data.valid
            ? `Chain verified: ${verifyQuery.data.checked_count} records, hashes consistent, no gaps (ADR-006).`
            : `Chain integrity FAILED at record ${verifyQuery.data.broken_at_id} — ${verifyQuery.data.checked_count} records checked.`}
        </div>
      )}

      <FilterBar
        activeCount={urlFilters.active.length}
        onClear={urlFilters.clearAll}
        desktopClear={false}
      >
        <FilterField label="Action">
          <Input
            aria-label="Filter by action"
            placeholder="Filter by action (e.g. user.created)"
            autoComplete="off"
            value={action}
            onChange={(e) => urlFilters.setFilter('action', e.target.value)}
            className="w-56"
          />
        </FilterField>
        <FilterField label="Entity type">
          <Input
            aria-label="Filter by entity type"
            placeholder="Filter by entity type (e.g. project)"
            autoComplete="off"
            value={entityType}
            onChange={(e) => urlFilters.setFilter('entityType', e.target.value)}
            className="w-56"
          />
        </FilterField>
        <FilterField label="Entity ID">
          <Input
            aria-label="Filter by entity ID"
            placeholder="Filter by entity ID"
            autoComplete="off"
            value={entityId}
            onChange={(e) => urlFilters.setFilter('entityId', e.target.value)}
            className="w-56"
          />
        </FilterField>
        <FilterField label="User">
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
        </FilterField>
        <DateRangePicker
          idPrefix="audit-date"
          fromValue={dateFrom}
          toValue={dateTo}
          onChange={(from, to) => urlFilters.setFilters({ dateFrom: from, dateTo: to })}
        />
        {!isMobile && urlFilters.active.length > 0 && (
          <Button variant="outline" size="sm" onClick={urlFilters.clearAll}>
            Clear filters
          </Button>
        )}
      </FilterBar>

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

      {logsQuery.isLoading ? (
        <div role="status" className="flex flex-col gap-2">
          <span className="sr-only">Loading audit log</span>
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : logsQuery.isError ? (
        <div className="rounded-lg border border-[var(--border)] bg-[var(--background)]">
          <ErrorState message="The audit log could not be loaded." error={logsQuery.error} onRetry={() => logsQuery.refetch()} />
        </div>
      ) : isMobile ? (
        <ul aria-label="Audit log entries" className="flex flex-col gap-3">
          {entries?.length === 0 && (
            <li className="rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 py-6 text-center text-sm text-[var(--muted-foreground)]">
              No audit entries found.
            </li>
          )}
          {entries?.map((entry) => (
            <AuditCard
              key={entry.id}
              entry={entry}
              expanded={expandedId === entry.id}
              onToggle={() => setExpandedId(expandedId === entry.id ? null : entry.id)}
            />
          ))}
        </ul>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-[var(--border)]">
          <table aria-label="Audit log events" className="w-full text-sm">
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
              {entries?.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-[var(--muted-foreground)]">
                    No audit entries found.
                  </td>
                </tr>
              )}
              {entries?.map((entry) => (
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
      )}

      {logsQuery.hasNextPage && (
        <div className="flex justify-center">
          <Button
            variant="outline"
            onClick={() => logsQuery.fetchNextPage()}
            disabled={logsQuery.isFetchingNextPage}
          >
            {logsQuery.isFetchingNextPage ? 'Loading…' : 'Load more'}
          </Button>
        </div>
      )}
    </div>
  )
}

function AuditDetails({ entry }: { entry: AuditLogEntry }) {
  return (
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
  )
}

function AuditCard({
  entry,
  expanded,
  onToggle,
}: {
  entry: AuditLogEntry
  expanded: boolean
  onToggle: () => void
}) {
  return (
    <li className="qth-raised-sm rounded-xl border border-[var(--border)] bg-[var(--background)] p-3">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <Badge className="max-w-full break-all">{humanizeActionCode(entry.action)}</Badge>
        <span className="text-xs text-[var(--muted-foreground)]">
          {new Date(entry.created_at).toLocaleString()}
        </span>
      </div>
      <dl className="mt-2.5 grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
        <div className="min-w-0">
          <dt className="text-[var(--muted-foreground)]">User</dt>
          <dd className="mt-0.5 break-words">{entry.user_name ?? 'System'}</dd>
        </div>
        <div className="min-w-0">
          <dt className="text-[var(--muted-foreground)]">Entity</dt>
          <dd className="mt-0.5 break-words">
            {humanizeKey(entry.entity_type)} · {entry.entity_id.slice(0, 8)}
          </dd>
        </div>
      </dl>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className="mt-2 inline-flex min-h-11 min-w-11 items-center text-sm text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:underline"
      >
        {expanded ? 'Hide details' : 'Details'}
      </button>
      {expanded && (
        <div className="mt-1 border-t border-[var(--border)] pt-3">
          <AuditDetails entry={entry} />
        </div>
      )}
    </li>
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
          <Tooltip content={entry.action} side="bottom">
            <Badge>{humanizeActionCode(entry.action)}</Badge>
          </Tooltip>
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
            <AuditDetails entry={entry} />
          </td>
        </tr>
      )}
    </>
  )
}
