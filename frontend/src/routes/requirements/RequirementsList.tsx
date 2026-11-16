import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useParams } from 'react-router-dom'

import { ApiError } from '@/api/client'
import { getProject } from '@/api/projects'
import {
  createRequirement,
  getCoverageReport,
  listRequirements,
  type Requirement,
  type RequirementCreateRequest,
} from '@/api/requirements'
import { CARD_LINK_CLASS, ResponsiveTable, type ResponsiveColumn } from '@/components/table/ResponsiveTable'
import { Badge } from '@/components/ui/badge'
import { PageHeader } from '@/components/ui/PageHeader'
import { Button } from '@/components/ui/button'
import { Dialog, DialogFooter } from '@/components/ui/dialog'
import { EmptyState, ErrorState } from '@/components/ui/empty-state'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { useAuth } from '@/lib/auth'
import { isManagerOrAbove } from '@/api/auth'
import { useToast } from '@/lib/toast'
import { useUrlFilters } from '@/lib/useUrlFilters'
import { FormError } from '@/components/ui/form-field'
import { useNavigate } from 'react-router-dom'

const PAGE_SIZE = 20

const columns: ResponsiveColumn<Requirement>[] = [
  {
    key: 'title',
    header: 'Title',
    card: 'title',
    tdClassName: 'font-medium',
    cell: (r) => (
      <Link to={`/requirements/${r.id}`} className="underline-offset-2 hover:underline">
        {r.title}
      </Link>
    ),
    cardCell: (r) => (
      <Link to={`/requirements/${r.id}`} className={CARD_LINK_CLASS}>
        {r.title}
      </Link>
    ),
  },
  { key: 'version', header: 'Version', cell: (r) => `v${r.version_number}` },
  {
    key: 'linked',
    header: 'Linked Test Cases',
    cell: (r) => <Badge tone={r.linked_test_case_count > 0 ? 'positive' : 'neutral'}>{r.linked_test_case_count}</Badge>,
  },
]

// GAP-91 item 2: `GET /projects/{id}/requirements` only accepts
// page/page_size today (no search param), so a server-side search filter
// would need a backend change -- out of scope for this frontend rollout.
// Only `page` is URL-persisted here (still a real win: survives refresh,
// shareable). No bulk actions exist for requirements and the list is only
// 3 columns, so neither a bulk-action bar nor a column-picker applies.
export function RequirementsList() {
  const { projectId } = useParams<{ projectId: string }>()
  const { user } = useAuth()
  const canManage = isManagerOrAbove(user)
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [createOpen, setCreateOpen] = useState(false)
  const urlFilters = useUrlFilters({ page: '1' })
  const page = Number(urlFilters.values.page) || 1
  const setPage = (updater: (p: number) => number) =>
    urlFilters.setFilter('page', String(Math.max(1, updater(page))))
  const { show: showToast } = useToast()

  const projectQuery = useQuery({
    queryKey: ['projects', projectId],
    queryFn: () => getProject(projectId!),
    enabled: !!projectId,
  })
  const requirementsQuery = useQuery({
    queryKey: ['requirements', projectId, page],
    queryFn: () => listRequirements(projectId!, { page, page_size: PAGE_SIZE }),
    enabled: !!projectId,
  })
  const coverageQuery = useQuery({
    queryKey: ['requirements-coverage', projectId],
    queryFn: () => getCoverageReport(projectId!),
    enabled: !!projectId,
  })

  const createMutation = useMutation({
    mutationFn: (req: RequirementCreateRequest) => createRequirement(projectId!, req),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['requirements', projectId] })
      queryClient.invalidateQueries({ queryKey: ['requirements-coverage', projectId] })
      setCreateOpen(false)
      showToast('success', 'Requirement created')
    },
    // No onError toast -- `createError` below already renders this inline.
  })

  const createError = createMutation.error instanceof ApiError ? createMutation.error.message : null
  const total = requirementsQuery.data?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={`Requirements ${projectQuery.data ? `— ${projectQuery.data.name}` : ''}`.trim()}
        actions={
          canManage && (
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              New Requirement
            </Button>
          )
        }
      />

      {coverageQuery.data && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-[var(--border)] px-4 py-3 text-sm">
          <span className="font-medium">Coverage</span>
          <span>
            {coverageQuery.data.covered_requirements} / {coverageQuery.data.total_requirements}{' '}
            requirements have at least one linked test case
          </span>
          <Badge tone={coverageQuery.data.coverage_percentage === 100 ? 'positive' : 'neutral'}>
            {coverageQuery.data.coverage_percentage}%
          </Badge>
          <Link
            to={`/projects/${projectId}/traceability-matrix`}
            className="inline-flex min-h-11 items-center text-sm underline-offset-2 hover:underline md:ml-auto md:min-h-0"
          >
            View full Traceability Matrix →
          </Link>
        </div>
      )}

      <ResponsiveTable
        label="Requirements"
        rows={requirementsQuery.data?.items ?? []}
        rowKey={(r) => r.id}
        columns={columns}
        loading={requirementsQuery.isLoading}
        rowProps={(r) => ({
          tabIndex: 0,
          onKeyDown: (e) => {
            if (e.key === 'Enter') navigate(`/requirements/${r.id}`)
          },
          className:
            'cursor-pointer outline-none focus-visible:bg-[var(--muted)] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--ring)]',
        })}
        state={
          requirementsQuery.isError ? (
            <ErrorState onRetry={() => requirementsQuery.refetch()} />
          ) : !requirementsQuery.isLoading && requirementsQuery.data?.items.length === 0 ? (
            <EmptyState
              title="No requirements yet"
              description="Add a requirement to start tracking coverage against test cases."
            />
          ) : undefined
        }
      />

      {totalPages > 1 && (
        <div className="flex items-center justify-end gap-2 text-sm">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            Previous
          </Button>
          <span className="text-[var(--muted-foreground)]">
            Page {page} of {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
          >
            Next
          </Button>
        </div>
      )}

      <NewRequirementDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onSubmit={(req) => createMutation.mutate(req)}
        isPending={createMutation.isPending}
        error={createError}
      />
    </div>
  )
}

function NewRequirementDialog({
  open,
  onClose,
  onSubmit,
  isPending,
  error,
}: {
  open: boolean
  onClose: () => void
  onSubmit: (req: RequirementCreateRequest) => void
  isPending: boolean
  error: string | null
}) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')

  function handleSubmit() {
    onSubmit({ title, description })
    setTitle('')
    setDescription('')
  }

  return (
    <Dialog open={open} onClose={onClose} title="New Requirement">
      <div className="flex flex-col gap-3 text-sm">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="requirement-title">Title</Label>
          <Input id="requirement-title" value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="requirement-description">Description</Label>
          <Textarea
            id="requirement-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
        <FormError>{error}</FormError>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" disabled={isPending || title.length < 5} onClick={handleSubmit}>
            {isPending ? 'Creating…' : 'Create Requirement'}
          </Button>
        </DialogFooter>
      </div>
    </Dialog>
  )
}
