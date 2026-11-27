import { isStaleWrite } from '@/lib/staleWrite'
import { VersionDiffView } from './VersionDiffView'
import { useState, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronDown, ChevronUp, Unlink } from 'lucide-react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'

import { reviewTestCase } from '@/api/ai'
import { ApiError } from '@/api/client'
import { linkTestCase, listDefectsOfTestCase, unlinkTestCase } from '@/api/defects'
import { DefectStatusBadge } from '@/routes/defects/DefectStatusBadge'
import { DefectPicker } from '@/routes/defects/pickers'
import {  } from '@/routes/defects/DefectActionDialogs'
import { useDefectPermissions } from '@/lib/useDefectPermissions'
import { IconButton } from '@/components/ui/icon-button'
import {
  approveTestCase,
  compareTestCaseVersions,
  deleteTestCase,
  deprecateTestCase,
  duplicateTestCase,
  unquarantineTestCase,
  getTestCase,
  getTestCaseHistory,
  listTestCaseExecutions,
  listTestCaseVersions,
  requestChanges,
  submitForReview,
  type TestCase,
  type TestCaseVersion,
} from '@/api/testCases'
import type { HistoryEntry } from '@/api/history'
import { listUsers } from '@/api/users'
import { HistoryTimeline } from '@/components/HistoryTimeline'
import { changesOf } from '@/lib/historyChanges'
import { MarkdownText } from '@/components/Markdown'
import { Tabs, type TabItem } from '@/components/ui/tabs'
import { AttachmentsCard } from '@/components/AttachmentsCard'
import { CommentsCard } from '@/components/CommentsCard'
import { CustomFieldsCard } from '@/components/CustomFieldsCard'
import { TestDataSetsCard } from '@/components/TestDataSetsCard'
import { Badge } from '@/components/ui/badge'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { RecordPin } from '@/components/RecordPin'
import { PageHeader } from '@/components/ui/PageHeader'
import { DetailSkeleton } from '@/components/ui/skeleton'
import { EmptyState, ErrorState } from '@/components/ui/empty-state'
import { Button } from '@/components/ui/button'
import { useConfirm } from '@/components/ui/useConfirm'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogFooter } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { useAuth } from '@/lib/auth'
import { hasPermission, isAdmin, isManagerOrAbove } from '@/api/auth'
import { QuarantinedBadge } from '@/components/ui/QuarantinedBadge'
import { QuarantineDialog } from '@/components/ui/QuarantineDialog'
import { useToast } from '@/lib/toast'
import { useCanListUsers } from '@/lib/useCanListUsers'
import { FormError } from '@/components/ui/form-field'
import { LinkedRequirementsCard } from './LinkedRequirementsCard'
import { ExecutionStatusBadge } from './ExecutionStatusBadge'
import { formatWhen } from '@/lib/formatWhen'
import { STATUS_DISPLAY } from './statusDisplay'
import { defectPath, testCaseEditPath, testCasePath, testRunPath } from '@/lib/entityRoutes'
import { defectNewPath } from '@/lib/entityRoutes'

export function TestCaseDetail() {
  const { testCaseId } = useParams<{ testCaseId: string }>()
  const { user } = useAuth()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { show: showToast } = useToast()
  const [searchParams] = useSearchParams()
  const [quarantineOpen, setQuarantineOpen] = useState(false)
  const [reviewOpen, setReviewOpen] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [submitReviewOpen, setSubmitReviewOpen] = useState(false)
  const [reviewerId, setReviewerId] = useState('')
  const [requestChangesOpen, setRequestChangesOpen] = useState(false)
  const [changesComment, setChangesComment] = useState('')

  const caseQuery = useQuery({
    queryKey: ['test-cases', 'detail', testCaseId],
    queryFn: () => getTestCase(testCaseId!),
    enabled: !!testCaseId,
  })
  const versionsQuery = useQuery({
    queryKey: ['test-cases', 'versions', testCaseId],
    queryFn: () => listTestCaseVersions(testCaseId!),
    enabled: !!testCaseId,
  })
  const canListUsers = useCanListUsers()
  const usersQuery = useQuery({ queryKey: ['users'], queryFn: listUsers, enabled: canListUsers })
  const executionsQuery = useQuery({
    queryKey: ['test-cases', 'executions', testCaseId],
    queryFn: () => listTestCaseExecutions(testCaseId!, { page_size: 50 }),
    enabled: !!testCaseId,
  })
  const historyQuery = useQuery({
    queryKey: ['test-cases', 'history', testCaseId],
    queryFn: () => getTestCaseHistory(testCaseId!),
    enabled: !!testCaseId,
  })

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ['test-cases', 'detail', testCaseId] })
    queryClient.invalidateQueries({ queryKey: ['test-cases', 'versions', testCaseId] })
  }

  const duplicateMutation = useMutation({
    mutationFn: () => duplicateTestCase(testCaseId!),
    onSuccess: (copy) => {
      queryClient.invalidateQueries({ queryKey: ['test-cases'] })
      showToast('success', `Duplicated as ${copy.display_id ?? 'a new draft'}`)
      navigate(testCasePath(copy.project_id, copy.id))
    },
    onError: (err) => showToast('error', err instanceof ApiError ? err.message : 'Could not duplicate the test case'),
  })

  const ACTION_SUCCESS_MESSAGE: Record<'submit' | 'approve' | 'deprecate' | 'delete', string> = {
    submit: 'Submitted for review.',
    approve: 'Test case approved.',
    deprecate: 'Test case deprecated.',
    delete: 'Test case deleted.',
  }

  const runAction = useMutation({
    mutationFn: async (action: 'submit' | 'approve' | 'deprecate' | 'delete'): Promise<unknown> => {
      if (action === 'submit') return submitForReview(testCaseId!, reviewerId || null)
      if (action === 'approve') return approveTestCase(testCaseId!, caseQuery.data?.row_version)
      if (action === 'deprecate') return deprecateTestCase(testCaseId!)
      return deleteTestCase(testCaseId!)
    },
    onSuccess: (_, action) => {
      setActionError(null)
      showToast('success', ACTION_SUCCESS_MESSAGE[action])
      if (action === 'submit') {
        setSubmitReviewOpen(false)
        setReviewerId('')
      }
      if (action === 'delete') {
        navigate(`/projects/${testCase!.project_id}/test-cases`)
        return
      }
      invalidate()
    },
    onError: (err) => {
      // Show what it says now, so the next decision is about what is on screen.
      if (isStaleWrite(err)) invalidate()
      const message = err instanceof ApiError ? err.message : 'Something went wrong'
      setActionError(message)
      showToast('error', message)
    },
  })

  const requestChangesMutation = useMutation({
    mutationFn: () => requestChanges(testCaseId!, changesComment, caseQuery.data?.row_version),
    onSuccess: () => {
      showToast('success', 'Changes requested — sent back to draft.')
      setRequestChangesOpen(false)
      setChangesComment('')
      invalidate()
      queryClient.invalidateQueries({ queryKey: ['comments', 'test_case', testCaseId] })
    },
    onError: (err) => {
      if (isStaleWrite(err)) invalidate()
      showToast('error', err instanceof ApiError ? err.message : 'Something went wrong')
    },
  })

  const { ask, dialog: confirmDialog } = useConfirm()

  const testCase = caseQuery.data
  if (caseQuery.isLoading) return <DetailSkeleton />
  if (caseQuery.isError) return <ErrorState message="Could not load this test case." error={caseQuery.error} onRetry={() => caseQuery.refetch()} />
  if (!testCase) return <EmptyState title="Test case not found" description="It may have been deleted, or you may not have access to it." />

  const canApprove = isManagerOrAbove(user)
  const canQuarantine = hasPermission(user, 'testcase.approve')
  const isAssignedReviewer =
    testCase.reviewer_id === null || testCase.reviewer_id === user?.user_id || isAdmin(user)
  const canActOnReview = canApprove && isAssignedReviewer
  const usersById = new Map((usersQuery.data ?? []).map((u) => [u.id, u.name]))
  const canEdit = hasPermission(user, 'testcase.edit')
  const canCreate = hasPermission(user, 'testcase.create')
  const canDelete = hasPermission(user, 'testcase.delete')
  const executions = executionsQuery.data

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
      <PageHeader
        back={
          <Link
            to={`/projects/${testCase.project_id}/test-cases`}
            className="inline-flex text-xs text-[var(--muted-foreground)] hover:underline max-md:min-h-11 max-md:items-center max-md:text-sm"
          >
            ← Test Cases
          </Link>
        }
        title={testCase.title}
        meta={
          <>
            <RecordPin type="test_case" id={testCase.id} title={testCase.title} url={testCasePath(testCase.project_id, testCase.id)} />
            {testCase.display_id && (
              <span className="rounded-md bg-[var(--muted)] px-1.5 py-0.5 font-mono text-xs">{testCase.display_id}</span>
            )}
            <StatusBadge tone={STATUS_DISPLAY[testCase.status].tone}>
              Review Status: {STATUS_DISPLAY[testCase.status].label}
            </StatusBadge>
            <ExecutionStatusBadge status={testCase.execution_status} />
            {testCase.quarantined && <QuarantinedBadge title={testCase.quarantine_reason} />}
            <span className="text-xs text-[var(--muted-foreground)]">v{testCase.version_number}</span>
          </>
        }
        description={testCase.description || undefined}
        actionsClassName="grid grid-cols-2 md:flex md:flex-wrap"
        actions={
          <>
        <Button
          variant="outline"
          size="sm"
          disabled={!canEdit}
          title={canEdit ? undefined : 'You need the Edit test case permission'}
          onClick={() => navigate(testCaseEditPath(testCase.project_id, testCase.id))}
        >
          Edit
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={!canCreate || duplicateMutation.isPending}
          title={canCreate ? 'Copy this test case into a new draft' : 'You need the Create test case permission'}
          onClick={() => duplicateMutation.mutate()}
        >
          Duplicate
        </Button>
        <Button variant="outline" size="sm" onClick={() => setReviewOpen(true)}>
          Review with AI
        </Button>
        {testCase.status === 'draft' && (
          <Button size="sm" onClick={() => setSubmitReviewOpen(true)} disabled={runAction.isPending}>
            Submit for Review
          </Button>
        )}
        {testCase.status === 'ready_for_review' && canActOnReview && (
          <>
            <Button size="sm" onClick={() => runAction.mutate('approve')} disabled={runAction.isPending}>
              Approve
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setRequestChangesOpen(true)}
              disabled={runAction.isPending}
            >
              Request Changes
            </Button>
          </>
        )}
        {canQuarantine &&
          (testCase.quarantined ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                ask({
                  title: 'Remove this test case from quarantine?',
                  description: 'New runs will include it again.',
                  confirmLabel: 'Remove quarantine',
                  run: async () => {
                    await unquarantineTestCase(testCase.id)
                    invalidate()
                    queryClient.invalidateQueries({ queryKey: ['reports'] })
                  },
                })
              }
            >
              Remove quarantine
            </Button>
          ) : (
            <Button variant="outline" size="sm" onClick={() => setQuarantineOpen(true)}>
              Quarantine
            </Button>
          ))}
        {testCase.status !== 'deprecated' && canApprove && (
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              ask({
                title: 'Deprecate this test case?',
                description:
                  'A deprecated test case can no longer be added to new runs and cannot be returned to Approved. Past results and history are kept.',
                confirmLabel: 'Deprecate',
                run: () => runAction.mutateAsync('deprecate'),
              })
            }
            disabled={runAction.isPending}
          >
            Deprecate
          </Button>
        )}
        <Button
          variant="destructive"
          size="sm"
          onClick={() =>
            ask({
              title: 'Delete this test case?',
              description: `“${testCase.title}” is removed from lists, search, reports and exports. Its runs, defects, versions and comments are kept, so past results stay intact.`,
              confirmLabel: 'Delete test case',
              run: () => runAction.mutateAsync('delete'),
            })
          }
          disabled={runAction.isPending || !canDelete}
          title={canDelete ? undefined : 'You need the Delete test case permission'}
        >
          Delete
        </Button>
          </>
        }
      />
        <p className="text-xs text-[var(--muted-foreground)]">
          Assignee: {testCase.assignee_id ? (usersById.get(testCase.assignee_id) ?? 'Unknown') : 'Unassigned'}
        </p>
        {testCase.status === 'ready_for_review' && (
          <p className="text-xs text-[var(--muted-foreground)]">
            Reviewer:{' '}
            {testCase.reviewer_id ? (testCase.reviewer_name ?? 'Unknown') : 'Anyone who can approve'}
          </p>
        )}
      </div>
      {confirmDialog}
      <FormError>{actionError}</FormError>

      <Tabs
        defaultKey={searchParams.get('tab') ?? 'details'}
        items={buildTabs({
          testCase,
          versions: versionsQuery.data ?? [],
          usersById,
          history: historyQuery.data,
          executions,
          executionsLoading: executionsQuery.isLoading,
          canManageRequirements: hasPermission(user, 'requirement.manage'),
        })}
      />

      <ReviewWithAIDialog
        open={reviewOpen}
        onClose={() => setReviewOpen(false)}
        testCaseId={testCase.id}
      />
      <QuarantineDialog
        testCaseId={testCase.id}
        title={testCase.title}
        open={quarantineOpen}
        onClose={() => setQuarantineOpen(false)}
      />
      <Dialog
        open={submitReviewOpen}
        onClose={() => setSubmitReviewOpen(false)}
        title="Submit for Review"
      >
        <div className="flex flex-col gap-3 text-sm">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="reviewer">Reviewer (optional)</Label>
            <Select id="reviewer" value={reviewerId} onChange={(e) => setReviewerId(e.target.value)}>
              <option value="">Anyone who can approve</option>
              {(usersQuery.data ?? [])
                .filter((u) => u.role === 'admin' || u.role === 'manager')
                .map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setSubmitReviewOpen(false)}>
              Cancel
            </Button>
            <Button size="sm" disabled={runAction.isPending} onClick={() => runAction.mutate('submit')}>
              {runAction.isPending ? 'Submitting…' : 'Submit'}
            </Button>
          </DialogFooter>
        </div>
      </Dialog>
      <Dialog
        open={requestChangesOpen}
        onClose={() => setRequestChangesOpen(false)}
        title="Request Changes"
      >
        <div className="flex flex-col gap-3 text-sm">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="changes-comment">Feedback for the author</Label>
            <Textarea
              id="changes-comment"
              value={changesComment}
              onChange={(e) => setChangesComment(e.target.value)}
              rows={4}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setRequestChangesOpen(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={requestChangesMutation.isPending || changesComment.trim().length === 0}
              onClick={() => requestChangesMutation.mutate()}
            >
              {requestChangesMutation.isPending ? 'Sending…' : 'Send Back for Changes'}
            </Button>
          </DialogFooter>
        </div>
      </Dialog>
    </div>
  )
}

const TEST_CASE_HISTORY_ACTION_LABEL: Record<string, string> = {
  'testcase.created': 'Test case created',
  'testcase.duplicated': 'Duplicated from another test case',
  'testcase.updated': 'Updated',
  'testcase.submitted_for_review': 'Submitted for review',
  'testcase.approved': 'Approved',
  'testcase.deprecated': 'Deprecated',
  'testcase.deleted': 'Deleted',
  'comment.created': 'Comment added',
  'comment.deleted': 'Comment deleted',
  'ai.test_cases_generated': 'Generated by AI',
  'ai.test_case_reviewed': 'Reviewed by AI',
}

const CATEGORY_LABEL: Record<string, string> = {
  clarity: 'Clarity',
  missing_steps: 'Missing Steps',
  ambiguous_expected: 'Ambiguous Expected Result',
  other: 'Other',
}

function ReviewWithAIDialog({
  open,
  onClose,
  testCaseId,
}: {
  open: boolean
  onClose: () => void
  testCaseId: string
}) {
  const reviewMutation = useMutation({ mutationFn: () => reviewTestCase(testCaseId) })

  const serverError =
    reviewMutation.error instanceof ApiError ? reviewMutation.error.message : null
  const result = reviewMutation.data

  return (
    <Dialog
      open={open}
      onClose={() => {
        reviewMutation.reset()
        onClose()
      }}
      title="Review Test Case with AI"
    >
      <div className="flex flex-col gap-3 text-sm">
        <p className="text-xs text-[var(--muted-foreground)]">
          Checks this test case's title, description, and steps for clarity, missing steps, and
          ambiguous expected results. This only surfaces suggestions — nothing here is applied to
          the test case automatically; you decide what to change.
        </p>
        <FormError>{serverError}</FormError>
        {result && (
          <div className="flex flex-col gap-2">
            {result.suggestions.length === 0 ? (
              <p className="text-xs text-[var(--status-good)]">No issues found.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {result.suggestions.map((s, i) => (
                  <li key={i} className="rounded-md border border-[var(--border)] p-2 text-xs">
                    <Badge tone="neutral">{CATEGORY_LABEL[s.category] ?? s.category}</Badge>
                    <p className="mt-1">{s.message}</p>
                  </li>
                ))}
              </ul>
            )}
            <p className="text-xs text-[var(--muted-foreground)]">{result.total_tokens} tokens used.</p>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose}>
            Close
          </Button>
          <Button size="sm" disabled={reviewMutation.isPending} onClick={() => reviewMutation.mutate()}>
            {reviewMutation.isPending ? 'Reviewing…' : 'Review'}
          </Button>
        </DialogFooter>
      </div>
    </Dialog>
  )
}

function VersionHistoryCard({
  testCaseId,
  versions,
  usersById,
}: {
  testCaseId: string
  versions: TestCaseVersion[]
  usersById: Map<string, string>
}) {
  const [expanded, setExpanded] = useState<number | null>(null)
  const [compareFrom, setCompareFrom] = useState('')
  const [compareTo, setCompareTo] = useState('')

  const compareQuery = useQuery({
    queryKey: ['test-cases', 'compare', testCaseId, compareFrom, compareTo],
    queryFn: () =>
      compareTestCaseVersions(testCaseId, Number(compareFrom), Number(compareTo)),
    enabled: !!compareFrom && !!compareTo && compareFrom !== compareTo,
  })

  const sorted = [...versions].sort((a, b) => b.version_number - a.version_number)

  return (
    <Card>
      <CardHeader>
        <CardTitle>Version History</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <ul className="flex flex-col gap-2 text-sm">
          {sorted.map((v) => (
            <li key={v.version_number} className="border-b border-[var(--border)] pb-2 last:border-0">
              <button
                type="button"
                className="flex w-full items-center justify-between text-left max-md:min-h-11"
                onClick={() => setExpanded(expanded === v.version_number ? null : v.version_number)}
              >
                <span className="font-medium">v{v.version_number}</span>
                {expanded === v.version_number ? (
                  <ChevronUp className="size-4" />
                ) : (
                  <ChevronDown className="size-4" />
                )}
              </button>
              <p className="text-xs text-[var(--muted-foreground)]">
                By {usersById.get(v.created_by) ?? 'Unknown'} on{' '}
                {new Date(v.created_at).toLocaleDateString()}
                {v.approved_at && ` · Approved ${new Date(v.approved_at).toLocaleDateString()}`}
              </p>
              {expanded === v.version_number && (
                <div className="mt-2 rounded-md bg-[var(--muted)] p-2 text-xs">
                  <p className="font-medium">{v.title}</p>
                  {v.description && <p className="mt-1 text-[var(--muted-foreground)]">{v.description}</p>}
                  <ol className="mt-2 flex flex-col gap-1">
                    {v.steps.map((s) => (
                      <li key={s.step_number}>
                        {s.step_number}. {s.action} → {s.expected}
                      </li>
                    ))}
                  </ol>
                </div>
              )}
            </li>
          ))}
        </ul>

        {versions.length > 1 && (
          <div className="border-t border-[var(--border)] pt-3">
            <Label>Compare Versions</Label>
            <div className="mt-1.5 flex items-center gap-2">
              <Select
                aria-label="Compare from version"
                value={compareFrom}
                onChange={(e) => setCompareFrom(e.target.value)}
                className="w-24"
              >
                <option value="">From…</option>
                {versions.map((v) => (
                  <option key={v.version_number} value={v.version_number}>
                    v{v.version_number}
                  </option>
                ))}
              </Select>
              <span className="text-xs text-[var(--muted-foreground)]">to</span>
              <Select
                aria-label="Compare to version"
                value={compareTo}
                onChange={(e) => setCompareTo(e.target.value)}
                className="w-24"
              >
                <option value="">To…</option>
                {versions.map((v) => (
                  <option key={v.version_number} value={v.version_number}>
                    v{v.version_number}
                  </option>
                ))}
              </Select>
            </div>

            {compareQuery.data && <VersionDiffView compare={compareQuery.data} />}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

/**
 * The Defects tab (ADR-118 / ADR-119): every defect linked to this case through either link model, from
 * the same source the defect's own Linked Test Cases tab reads. Defects can be reported from here (the
 * form opens with this case already linked), linked from the project's defects, or unlinked.
 */
function DefectsTab({ testCase }: { testCase: TestCase }) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const { show: showToast } = useToast()
  const { ask, dialog } = useConfirm()
  const perms = useDefectPermissions()
  const query = useQuery({
    queryKey: ['defects', 'of-test-case', testCase.id],
    queryFn: () => listDefectsOfTestCase(testCase.id),
  })
  const defects = query.data ?? []
  function refresh() {
    void queryClient.invalidateQueries({ queryKey: ['defects'] })
    void queryClient.invalidateQueries({ queryKey: ['test-cases'] })
  }
  const link = useMutation({
    mutationFn: (defectId: string) => linkTestCase(defectId, testCase.id),
    onSuccess: () => {
      refresh()
      showToast('success', 'Defect linked')
    },
    onError: (err) => showToast('error', err instanceof ApiError ? err.message : 'Could not link the defect'),
  })
  const unlink = useMutation({
    mutationFn: (defectId: string) => unlinkTestCase(defectId, testCase.id),
    onSuccess: () => {
      refresh()
      showToast('success', 'Defect unlinked')
    },
    onError: (err) => showToast('error', err instanceof ApiError ? err.message : 'Could not unlink the defect'),
  })
  const busy = link.isPending || unlink.isPending

  return (
    <Card>
      <CardHeader>
        <CardTitle>Defects {defects.length > 0 && `(${defects.length})`}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p className="text-xs text-[var(--muted-foreground)]">
          The defects found by this test case or linked to it. The same links show on each defect's Linked Test Cases tab.
        </p>
        <div className="flex flex-wrap items-end gap-3">
          {perms.canEdit && (
            <div className="min-w-[16rem] max-w-xl flex-1">
              <DefectPicker
                id="case-link-defect"
                projectId={testCase.project_id}
                excludeIds={defects.map((d) => d.id)}
                label="Link an existing defect"
                disabled={busy}
                onPick={(item) => link.mutate(item.id)}
              />
            </div>
          )}
          {perms.canCreate && (
            <Button
              variant="outline"
              onClick={() =>
                navigate(defectNewPath(testCase.project_id), {
                  state: {
                    prefill: { project_id: testCase.project_id, test_case_ids: [testCase.id], module_id: testCase.module_id ?? '' },
                    caseInfo: [{ id: testCase.id, display_id: testCase.display_id, title: testCase.title }],
                  },
                })
              }
            >
              Report defect
            </Button>
          )}
        </div>
        {query.isLoading ? (
          <p className="text-sm text-[var(--muted-foreground)]">Loading defects…</p>
        ) : defects.length === 0 ? (
          <p className="text-sm text-[var(--muted-foreground)]">No defects linked to this test case.</p>
        ) : (
          <div className="relative overflow-x-auto rounded-lg border border-[var(--border)]">
            <table aria-label="Linked defects" className="w-full text-sm">
              <thead className="bg-[var(--muted)] text-left text-xs text-[var(--muted-foreground)]">
                <tr>
                  {['Bug ID', 'Title', 'Status', 'Severity', 'Priority', 'Assignee', ''].map((h, i) => (
                    <th key={`${h}-${i}`} scope="col" className="px-3 py-2 font-medium">
                      {h || <span className="sr-only">Actions</span>}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {defects.map((d) => (
                  <tr key={d.id} className="border-t border-[var(--border)] align-top">
                    <td className="whitespace-nowrap px-3 py-2">
                      <Link to={defectPath(testCase.project_id, d.id)} className="font-mono text-xs underline-offset-2 hover:underline">
                        {d.display_id ?? d.id.slice(0, 8)}
                      </Link>
                    </td>
                    <td className="px-3 py-2">{d.title}</td>
                    <td className="px-3 py-2">
                      <DefectStatusBadge status={d.status} />
                    </td>
                    <td className="px-3 py-2">{d.severity}</td>
                    <td className="px-3 py-2">{d.priority}</td>
                    <td className="px-3 py-2">{d.assigned_to_name ?? 'Unassigned'}</td>
                    <td className="px-3 py-2 text-right">
                      {perms.canEdit && (
                        <IconButton
                          aria-label={`Unlink ${d.display_id ?? d.title}`}
                          disabled={busy}
                          onClick={() =>
                            ask({
                              title: `Unlink ${d.display_id ?? 'this defect'}?`,
                              description: 'The defect and this test case stay as they are; only the link between them is removed.',
                              confirmLabel: 'Unlink defect',
                              run: () => unlink.mutateAsync(d.id),
                            })
                          }
                        >
                          <Unlink aria-hidden="true" />
                        </IconButton>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
      {dialog}
    </Card>
  )
}

interface TabArgs {
  testCase: TestCase
  versions: TestCaseVersion[]
  usersById: Map<string, string>
  history: HistoryEntry[] | undefined
  executions: { items: import('@/api/testCases').TestCaseExecution[]; total: number } | undefined
  executionsLoading: boolean
  canManageRequirements: boolean
}

function buildTabs({ testCase, versions, usersById, history, executions, executionsLoading, canManageRequirements }: TabArgs): TabItem[] {
  return [
    {
      key: 'details',
      label: 'Details',
      content: (
        <div className="flex flex-col gap-6">
          <DetailsCard testCase={testCase} usersById={usersById} />
          <LinkedRequirementsCard testCaseId={testCase.id} projectId={testCase.project_id} canManage={canManageRequirements} />
          <TestDataSetsCard testCaseId={testCase.id} />
          <CustomFieldsCard ownerType="test_case" ownerId={testCase.id} />
        </div>
      ),
    },
    { key: 'steps', label: 'Steps', count: testCase.steps.length, content: <StepsCard testCase={testCase} /> },
    {
      key: 'executions',
      label: 'Executions',
      count: executions?.total,
      content: <ExecutionsTab loading={executionsLoading} data={executions} testCaseId={testCase.id} projectId={testCase.project_id} />,
    },
    { key: 'defects', label: 'Defects', count: testCase.linked_defect_count, content: <DefectsTab testCase={testCase} /> },
    {
      key: 'versions',
      label: 'Versions',
      count: versions.length,
      content: <VersionHistoryCard testCaseId={testCase.id} versions={versions} usersById={usersById} />,
    },
    {
      key: 'discussion',
      label: 'Comments & Attachments',
      count: testCase.comment_count + testCase.attachment_count,
      content: (
        <div className="flex flex-col gap-6">
          <CommentsCard ownerType="test_case" ownerId={testCase.id} />
          <AttachmentsCard ownerType="test_case" ownerId={testCase.id} />
        </div>
      ),
    },
    { key: 'history', label: 'History', content: <HistoryTab entries={history} /> },
  ]
}

function Field({ label, children, wide }: { label: string; children: ReactNode; wide?: boolean }) {
  return (
    <div className={wide ? 'sm:col-span-2 lg:col-span-3' : undefined}>
      <p className="text-xs text-[var(--muted-foreground)]">{label}</p>
      <div className="mt-0.5 min-w-0 break-words text-sm">{children}</div>
    </div>
  )
}

function DetailsCard({ testCase, usersById }: { testCase: TestCase; usersById: Map<string, string> }) {
  const dash = <span className="text-[var(--muted-foreground)]">—</span>
  return (
    <Card>
      <CardHeader>
        <CardTitle>Details</CardTitle>
      </CardHeader>
      <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="Test Case ID">{testCase.display_id ? <span className="font-mono">{testCase.display_id}</span> : dash}</Field>
        <Field label="Requirement / User Story ID">{testCase.requirement_ref ?? dash}</Field>
        <Field label="Module">{testCase.module_path ?? 'Ungrouped'}</Field>
        <Field label="Test Type">{testCase.test_type ?? dash}</Field>
        <Field label="Priority">{testCase.priority}</Field>
        <Field label="Severity">{testCase.severity ?? dash}</Field>
        <Field label="Automation Status">{testCase.automation_status ?? dash}</Field>
        <Field label="Environment">{testCase.environment ?? dash}</Field>
        <Field label="Created By">{testCase.created_by_name ?? usersById.get(testCase.created_by) ?? dash}</Field>
        <Field label="Assignee">{testCase.assignee_id ? (usersById.get(testCase.assignee_id) ?? 'Unknown') : 'Unassigned'}</Field>
        <Field label="Review Status">
          {STATUS_DISPLAY[testCase.status].label}
          {testCase.status === 'ready_for_review' && (
            <span className="text-xs text-[var(--muted-foreground)]">
              {' '}
              (reviewer: {testCase.reviewer_id ? (testCase.reviewer_name ?? 'Unknown') : 'anyone who can approve'})
            </span>
          )}
        </Field>
        <Field label="Description" wide>
          <MarkdownText source={testCase.description} />
        </Field>
        <Field label="Preconditions" wide>
          <MarkdownText source={testCase.preconditions ?? testCase.prerequisite} />
        </Field>
        <Field label="Test Data" wide>
          {testCase.test_data ? (
            <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded-md bg-[var(--muted)] p-2 font-mono text-xs">{testCase.test_data}</pre>
          ) : (
            dash
          )}
        </Field>
        <Field label="Expected Result" wide>
          <MarkdownText source={testCase.expected_result} />
        </Field>
        <Field label="Postconditions" wide>
          <MarkdownText source={testCase.postconditions} />
        </Field>
        {(testCase.scenario_id || testCase.scenario_description) && (
          <Field label="Scenario" wide>
            {[testCase.scenario_id, testCase.scenario_description].filter(Boolean).join(' - ')}
          </Field>
        )}
        <div className="border-l border-[var(--border)] pl-3 sm:col-span-2 lg:col-span-3">
          <p className="text-xs text-[var(--muted-foreground)]">
            Latest execution <span className="italic">(read-only: results are recorded in test runs, never on the definition)</span>
          </p>
          {testCase.execution_status === 'Not Run' ? (
            <p className="mt-1 text-sm">Not yet executed.</p>
          ) : (
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
              <ExecutionStatusBadge status={testCase.execution_status} />
              <span>
                by {testCase.last_executed_by ?? 'Unknown'} on {formatWhen(testCase.last_executed_at)}
              </span>
              {testCase.last_actual_result && <span className="text-[var(--muted-foreground)]">Actual: {testCase.last_actual_result}</span>}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

function StepsCard({ testCase }: { testCase: TestCase }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Steps</CardTitle>
      </CardHeader>
      <CardContent>
        <ol className="flex flex-col gap-3 text-sm">
          {testCase.steps.map((step) => (
            <li key={step.step_number} className="border-b border-[var(--border)] pb-3 last:border-0">
              <p className="break-words font-medium">
                {step.step_number}. {step.action}
              </p>
              {step.test_data && <p className="mt-0.5 break-words text-[var(--muted-foreground)]">Test data: {step.test_data}</p>}
              <p className="mt-0.5 break-words text-[var(--muted-foreground)]">Expected: {step.expected}</p>
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  )
}

function ExecutionsTab({
  loading,
  data,
  testCaseId,
  projectId,
}: {
  loading: boolean
  data: { items: import('@/api/testCases').TestCaseExecution[]; total: number } | undefined
  testCaseId: string
  projectId: string
}) {
  void testCaseId
  return (
    <Card>
      <CardHeader>
        <CardTitle>Execution history</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p className="text-xs text-[var(--muted-foreground)]">
          One row per time this test case was run, newest first. Executing happens in a test run, so the definition above is
          never overwritten.
        </p>
        {loading ? (
          <p className="text-sm text-[var(--muted-foreground)]">Loading executions…</p>
        ) : !data || data.items.length === 0 ? (
          <p className="text-sm text-[var(--muted-foreground)]">This test case has not been executed yet.</p>
        ) : (
          <div className="relative overflow-x-auto rounded-lg border border-[var(--border)]">
            <table aria-label="Execution history" className="w-full text-sm">
              <thead className="bg-[var(--muted)] text-left text-xs text-[var(--muted-foreground)]">
                <tr>
                  {['Run', 'Date', 'Executed by', 'Status', 'Actual result', 'Version', 'Defects'].map((h) => (
                    <th key={h} scope="col" className="px-3 py-2 font-medium">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.items.map((e) => (
                  <tr key={e.test_run_case_id} className="border-t border-[var(--border)] align-top">
                    <td className="px-3 py-2">
                      <Link to={testRunPath(projectId, e.test_run_id)} className="underline-offset-2 hover:underline">
                        {e.run_name}
                      </Link>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2">{formatWhen(e.executed_at)}</td>
                    <td className="px-3 py-2">{e.executed_by_name ?? '—'}</td>
                    <td className="px-3 py-2">
                      <ExecutionStatusBadge status={e.execution_status} />
                    </td>
                    <td className="max-w-[24rem] whitespace-pre-wrap break-words px-3 py-2">
                      {e.actual_result || e.blocked_reason || <span className="text-[var(--muted-foreground)]">—</span>}
                    </td>
                    <td className="px-3 py-2">v{e.version_number}</td>
                    <td className="px-3 py-2">
                      {e.defects.length === 0 ? (
                        '—'
                      ) : (
                        <span className="flex flex-wrap gap-x-2">
                          {e.defects.map((d) => (
                            <Link key={d.id} to={defectPath(projectId, d.id)} className="underline underline-offset-2">
                              {d.display_id ?? d.title}
                            </Link>
                          ))}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {data && data.total > data.items.length && (
          <p className="text-xs text-[var(--muted-foreground)]">
            Showing the latest {data.items.length} of {data.total} executions.
          </p>
        )}
      </CardContent>
    </Card>
  )
}

/** Audit timeline for this test case, with before / after values where the event recorded them. */
function HistoryTab({ entries }: { entries: HistoryEntry[] | undefined }) {
  return (
    <HistoryTimeline
      entries={entries?.map((e) => ({ id: e.id, action: e.action, user_name: e.user_name, created_at: e.created_at, changes: changesOf(e.event_metadata) }))}
      labels={TEST_CASE_HISTORY_ACTION_LABEL}
    />
  )
}
