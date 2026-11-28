import { useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'

import { listFieldOptions } from '@/api/fieldCustomization'
import { listProjectMembers } from '@/api/projects'
import { listRequirements, type RequirementListParams, type RequirementStatus } from '@/api/requirements'
import { Badge } from '@/components/ui/badge'
import { ImportWizard } from '@/components/import/ImportWizard'
import { Button } from '@/components/ui/button'
import { EmptyState, ErrorState } from '@/components/ui/empty-state'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { DetailSkeleton } from '@/components/ui/skeleton'
import { requirementPath } from '@/lib/entityRoutes'
import { REQUIREMENT_STATUS_LABEL, REQUIREMENT_STATUS_TONE } from '@/lib/requirements'
import { useDebouncedValue } from '@/lib/useDebouncedValue'
import { useUrlFilters } from '@/lib/useUrlFilters'

export const REQUIREMENTS_PAGE_SIZE = 25
const FILTERS = { rq: '', rstatus: '', rtype: '', rpriority: '', rowner: '', rtests: '', rpage: '1' }
const CLEARED = { rq: '', rstatus: '', rtype: '', rpriority: '', rowner: '', rtests: '', rpage: '1' }
const TESTS: Record<string, { label: string; params: RequirementListParams }> = {
  covered: { label: 'Has test cases', params: { covered: true } },
  uncovered: { label: 'No test cases', params: { covered: false } },
  review: { label: 'Tests need review', params: { needs_review: true } },
}
const TH = 'px-3 py-2 text-left text-xs font-medium text-[var(--muted-foreground)]'
const TD = 'px-3 py-2 align-top'

/** ADR-149: every requirement of the project in one place. Each still belongs to a task (ADR-128). */
export function RequirementsView({ projectId, canImport = false }: { projectId: string; canImport?: boolean }) {
  const [importing, setImporting] = useState(false)
  const { values: v, setFilters } = useUrlFilters(FILTERS)
  const [search, setSearch] = useState(v.rq)
  const needle = useDebouncedValue(search.trim(), 300)
  const page = Number(v.rpage) || 1
  const filtered = [needle, v.rstatus, v.rtype, v.rpriority, v.rowner, v.rtests].some(Boolean)

  const query = useQuery({
    queryKey: ['requirements', projectId, 'view', needle, v.rstatus, v.rtype, v.rpriority, v.rowner, v.rtests, page],
    queryFn: () =>
      listRequirements(projectId, {
        page,
        page_size: REQUIREMENTS_PAGE_SIZE,
        q: needle || undefined,
        status: (v.rstatus || undefined) as RequirementStatus | undefined,
        requirement_type: v.rtype || undefined,
        priority: v.rpriority || undefined,
        owner_id: v.rowner || undefined,
        ...TESTS[v.rtests]?.params,
      }),
    placeholderData: keepPreviousData,
  })
  const types = useQuery({ queryKey: ['field-options', 'requirement_type'], queryFn: () => listFieldOptions('requirement_type') })
  const priorities = useQuery({
    queryKey: ['field-options', 'requirement_priority'],
    queryFn: () => listFieldOptions('requirement_priority'),
  })
  const members = useQuery({ queryKey: ['project-members', projectId], queryFn: () => listProjectMembers(projectId), retry: false })

  const filter = (id: string, label: string, key: keyof typeof FILTERS, all: string, options: { value: string; label: string }[]) => (
    <div className="flex min-w-36 flex-col gap-1.5">
      <label htmlFor={id} className="text-xs font-medium text-[var(--muted-foreground)]">
        {label}
      </label>
      <Select id={id} value={v[key]} onChange={(e) => setFilters({ [key]: e.target.value, rpage: '1' })}>
        <option value="">{all}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </Select>
    </div>
  )
  const clear = () => {
    setSearch('')
    setFilters(CLEARED)
  }

  const items = query.data?.items ?? []
  const total = query.data?.total ?? 0
  const pages = Math.max(1, Math.ceil(total / REQUIREMENTS_PAGE_SIZE))

  return (
    <div className="flex flex-col gap-3">
      {canImport && (
        <div className="flex justify-end">
          <Button variant="outline" size="sm" onClick={() => setImporting(true)}>
            Import requirements
          </Button>
        </div>
      )}
      <ImportWizard
        open={importing}
        onClose={() => setImporting(false)}
        kind="requirement"
        noun="requirement"
        projectId={projectId}
        viewHref={(id) => `/projects/${id}/tasks?view=requirements`}
      />
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex min-w-48 flex-1 flex-col gap-1.5">
          <label htmlFor="requirement-search" className="text-xs font-medium text-[var(--muted-foreground)]">
            Search requirements
          </label>
          <Input
            id="requirement-search"
            placeholder="Title or ID"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value)
              setFilters({ rq: e.target.value.trim(), rpage: '1' })
            }}
          />
        </div>
        {filter('requirement-filter-status', 'Status', 'rstatus', 'All statuses', Object.entries(REQUIREMENT_STATUS_LABEL).map(([value, label]) => ({ value, label })))}
        {filter('requirement-filter-type', 'Type', 'rtype', 'All types', (types.data ?? []).map((o) => ({ value: o.code, label: o.label })))}
        {filter('requirement-filter-priority', 'Priority', 'rpriority', 'All priorities', (priorities.data ?? []).map((o) => ({ value: o.code, label: o.label })))}
        {filter('requirement-filter-owner', 'Owner', 'rowner', 'Anyone', (members.data ?? []).map((m) => ({ value: m.user_id, label: m.name })))}
        {filter('requirement-filter-tests', 'Test cases', 'rtests', 'Any', Object.entries(TESTS).map(([value, t]) => ({ value, label: t.label })))}
      </div>

      {query.isLoading ? (
        <DetailSkeleton />
      ) : query.isError ? (
        <ErrorState message="Could not load requirements." error={query.error} onRetry={() => query.refetch()} />
      ) : items.length === 0 ? (
        filtered ? (
          <EmptyState
            variant="filtered"
            title="No requirements match these filters"
            action={
              <Button variant="outline" size="sm" onClick={clear}>
                Clear filters
              </Button>
            }
          />
        ) : (
          <EmptyState title="No requirements yet" description="Use New Requirement, or add one on a task’s Requirements tab." />
        )
      ) : (
        <>
          <p role="status" className="text-xs text-[var(--muted-foreground)]">
            {total} requirement{total === 1 ? '' : 's'}
          </p>
          <div className="overflow-x-auto rounded-xl border border-[var(--border)]">
            <table aria-label="Requirements" className="w-full min-w-[56rem] text-sm">
              <thead>
                <tr>
                  {['ID', 'Title', 'Status', 'Type', 'Priority', 'Owner', 'Task', 'Test cases'].map((h) => (
                    <th key={h} scope="col" className={TH}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {items.map((r) => (
                  <tr key={r.id} className="border-t border-[var(--border)]">
                    <td className={`${TD} whitespace-nowrap font-mono text-xs`}>{r.display_id}</td>
                    <td className={`${TD} font-medium`}>
                      <Link to={requirementPath(projectId, r.id)} className="underline-offset-2 hover:underline">
                        {r.title}
                      </Link>
                    </td>
                    <td className={TD}>
                      <Badge tone={REQUIREMENT_STATUS_TONE[r.status]}>{REQUIREMENT_STATUS_LABEL[r.status]}</Badge>
                    </td>
                    <td className={TD}>{r.requirement_type}</td>
                    <td className={TD}>{r.priority}</td>
                    <td className={TD}>{r.owner_name ?? '—'}</td>
                    <td className={`${TD} whitespace-nowrap font-mono text-xs`}>
                      {r.task_id ? (
                        <Link to={`/projects/${projectId}/tasks/${r.task_id}`} className="underline-offset-2 hover:underline">
                          {r.task_display_id}
                        </Link>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className={TD}>
                      <span className="flex flex-wrap gap-1">
                        <Badge tone={r.linked_test_case_count > 0 ? 'positive' : 'warning'}>
                          {r.linked_test_case_count === 0 ? 'None' : r.linked_test_case_count}
                        </Badge>
                        {r.review_count > 0 && <Badge tone="warning">{r.review_count} to review</Badge>}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {pages > 1 && (
        <div className="flex items-center justify-end gap-2 text-sm">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setFilters({ rpage: String(page - 1) })}>
            Previous
          </Button>
          <span className="text-[var(--muted-foreground)]">
            Page {page} of {pages}
          </span>
          <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => setFilters({ rpage: String(page + 1) })}>
            Next
          </Button>
        </div>
      )}
    </div>
  )
}
