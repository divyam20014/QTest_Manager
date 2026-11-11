import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { Link, useNavigate, useParams } from 'react-router-dom'

import { reviewTestCase } from '@/api/ai'
import { ApiError } from '@/api/client'
import { listDefects } from '@/api/defects'
import { STATUS_TONE } from '@/routes/defects/statusDisplay'
import {
  approveTestCase,
  compareTestCaseVersions,
  deleteTestCase,
  deprecateTestCase,
  getTestCase,
  getTestCaseHistory,
  listTestCaseVersions,
  requestChanges,
  submitForReview,
  updateTestCase,
  type TestCaseUpdateRequest,
  type TestCaseVersion,
} from '@/api/testCases'
import { listUsers } from '@/api/users'
import { listModules } from '@/api/modules'
import { ActivityTimelineCard } from '@/components/ActivityTimelineCard'
import { AttachmentsCard } from '@/components/AttachmentsCard'
import { CommentsCard } from '@/components/CommentsCard'
import { CustomFieldsCard } from '@/components/CustomFieldsCard'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, Drawer } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { useAuth } from '@/lib/auth'
import { isAdmin, isManagerOrAbove } from '@/api/auth'
import { useToast } from '@/lib/toast'
import { TestCaseForm, type TestCaseFormValues } from './TestCaseForm'
import { STATUS_DISPLAY } from './statusDisplay'

export function TestCaseDetail() {
  const { testCaseId } = useParams<{ testCaseId: string }>()
  const { user } = useAuth()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { show: showToast } = useToast()
  const [editOpen, setEditOpen] = useState(false)
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
  const usersQuery = useQuery({ queryKey: ['users'], queryFn: listUsers })
  const modulesQuery = useQuery({
    queryKey: ['test-modules', caseQuery.data?.project_id],
    queryFn: () => listModules(caseQuery.data!.project_id),
    enabled: !!caseQuery.data?.project_id,
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

  const updateMutation = useMutation({
    mutationFn: (req: TestCaseUpdateRequest) => updateTestCase(testCaseId!, req),
    onSuccess: () => {
      invalidate()
      setEditOpen(false)
    },
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
      if (action === 'approve') return approveTestCase(testCaseId!)
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
      const message = err instanceof ApiError ? err.message : 'Something went wrong'
      setActionError(message)
      showToast('error', message)
    },
  })

  const requestChangesMutation = useMutation({
    mutationFn: () => requestChanges(testCaseId!, changesComment),
    onSuccess: () => {
      showToast('success', 'Changes requested — sent back to draft.')
      setRequestChangesOpen(false)
      setChangesComment('')
      invalidate()
      queryClient.invalidateQueries({ queryKey: ['comments', 'test_case', testCaseId] })
    },
    onError: (err) =>
      showToast('error', err instanceof ApiError ? err.message : 'Something went wrong'),
  })

  const testCase = caseQuery.data
  if (caseQuery.isLoading) return <p className="text-sm text-[var(--muted-foreground)]">Loading…</p>
  if (caseQuery.isError || !testCase) return <p className="text-sm text-[var(--destructive)]">Test case not found.</p>

  const canApprove = isManagerOrAbove(user)
  const isAssignedReviewer =
    testCase.reviewer_id === null || testCase.reviewer_id === user?.user_id || isAdmin(user)
  const canActOnReview = canApprove && isAssignedReviewer
  const updateError = updateMutation.error instanceof ApiError ? updateMutation.error.message : null
  const usersById = new Map((usersQuery.data ?? []).map((u) => [u.id, u.name]))

  const formValues: TestCaseFormValues = {
    title: testCase.title,
    module_id: testCase.module_id ?? '',
    description: testCase.description,
    priority: testCase.priority,
    assignee_id: testCase.assignee_id ?? '',
    scenario_id: testCase.scenario_id ?? '',
    scenario_description: testCase.scenario_description ?? '',
    prerequisite: testCase.prerequisite ?? '',
    test_data: testCase.test_data ?? '',
    steps: testCase.steps.map((s) => ({ action: s.action, expected: s.expected })),
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link
          to={`/projects/${testCase.project_id}/test-cases`}
          className="text-xs text-[var(--muted-foreground)] hover:underline"
        >
          ← Test Cases
        </Link>
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-semibold">{testCase.title}</h1>
          <Badge tone={STATUS_DISPLAY[testCase.status].tone}>{STATUS_DISPLAY[testCase.status].label}</Badge>
          <span className="text-xs text-[var(--muted-foreground)]">v{testCase.version_number}</span>
        </div>
        {testCase.description && (
          <p className="mt-1 max-w-2xl text-sm text-[var(--muted-foreground)]">{testCase.description}</p>
        )}
        <p className="mt-1 text-xs text-[var(--muted-foreground)]">
          Assignee: {testCase.assignee_id ? (usersById.get(testCase.assignee_id) ?? 'Unknown') : 'Unassigned'}
        </p>
        {testCase.status === 'ready_for_review' && (
          <p className="mt-1 text-xs text-[var(--muted-foreground)]">
            Reviewer:{' '}
            {testCase.reviewer_id ? (testCase.reviewer_name ?? 'Unknown') : 'Anyone who can approve'}
          </p>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
          Edit
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
        {testCase.status !== 'deprecated' && canApprove && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => runAction.mutate('deprecate')}
            disabled={runAction.isPending}
          >
            Deprecate
          </Button>
        )}
        <Button
          variant="destructive"
          size="sm"
          onClick={() => runAction.mutate('delete')}
          disabled={runAction.isPending}
        >
          Delete
        </Button>
      </div>
      {actionError && <p className="text-xs text-[var(--destructive)]">{actionError}</p>}

      <Card>
        <CardHeader>
          <CardTitle>Details</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <p className="text-xs text-[var(--muted-foreground)]">Scenario ID</p>
            <p>{testCase.scenario_id || '—'}</p>
          </div>
          <div className="sm:col-span-1 lg:col-span-3">
            <p className="text-xs text-[var(--muted-foreground)]">Scenario Description</p>
            <p>{testCase.scenario_description || '—'}</p>
          </div>
          <div>
            <p className="text-xs text-[var(--muted-foreground)]">Prerequisite</p>
            <p>{testCase.prerequisite || '—'}</p>
          </div>
          <div>
            <p className="text-xs text-[var(--muted-foreground)]">Test Data</p>
            <p>{testCase.test_data || '—'}</p>
          </div>
          <div className="border-l border-[var(--border)] pl-3 sm:col-span-2 lg:col-span-2">
            <p className="text-xs text-[var(--muted-foreground)]">
              Last Execution Result <span className="italic">(read-only, from the most recent run)</span>
            </p>
            {testCase.last_execution_result ? (
              <p>
                {testCase.last_execution_result} — executed by{' '}
                {testCase.last_executed_by_name ?? 'Unknown'} on{' '}
                {testCase.last_execution_date
                  ? new Date(testCase.last_execution_date).toLocaleString()
                  : '—'}
              </p>
            ) : (
              <p>Not yet executed</p>
            )}
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Steps</CardTitle>
          </CardHeader>
          <CardContent>
            <ol className="flex flex-col gap-3 text-sm">
              {testCase.steps.map((step) => (
                <li key={step.step_number} className="border-b border-[var(--border)] pb-2 last:border-0">
                  <p className="font-medium">
                    {step.step_number}. {step.action}
                  </p>
                  <p className="text-[var(--muted-foreground)]">Expected: {step.expected}</p>
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>

        <VersionHistoryCard
          testCaseId={testCase.id}
          versions={versionsQuery.data ?? []}
          usersById={usersById}
        />
      </div>

      <LinkedDefectsCard testCaseId={testCase.id} />
      <CustomFieldsCard ownerType="test_case" ownerId={testCase.id} />
      <AttachmentsCard ownerType="test_case" ownerId={testCase.id} />
      <CommentsCard ownerType="test_case" ownerId={testCase.id} />
      <ActivityTimelineCard entries={historyQuery.data} actionLabels={TEST_CASE_HISTORY_ACTION_LABEL} />

      {/* GAP-91 item 1: a 10+ field form no longer fits well in a centered
          Dialog -- a full-height Drawer gives it real room. */}
      <Drawer open={editOpen} onClose={() => setEditOpen(false)} title="Edit Test Case">
        <TestCaseForm
          defaultValues={formValues}
          submitLabel="Save Changes"
          isSubmitting={updateMutation.isPending}
          serverError={updateError}
          users={usersQuery.data ?? []}
          modules={modulesQuery.data ?? []}
          onSubmit={(values) => updateMutation.mutate(values)}
        />
      </Drawer>
      <ReviewWithAIDialog
        open={reviewOpen}
        onClose={() => setReviewOpen(false)}
        testCaseId={testCase.id}
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
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => setSubmitReviewOpen(false)}>
              Cancel
            </Button>
            <Button size="sm" disabled={runAction.isPending} onClick={() => runAction.mutate('submit')}>
              {runAction.isPending ? 'Submitting…' : 'Submit'}
            </Button>
          </div>
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
          <div className="flex justify-end gap-2">
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
          </div>
        </div>
      </Dialog>
    </div>
  )
}

const TEST_CASE_HISTORY_ACTION_LABEL: Record<string, string> = {
  'testcase.created': 'Test case created',
  'testcase.updated': 'Updated (new version)',
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
        {serverError && <p className="text-xs text-[var(--destructive)]">{serverError}</p>}
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
        <div className="flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={onClose}>
            Close
          </Button>
          <Button size="sm" disabled={reviewMutation.isPending} onClick={() => reviewMutation.mutate()}>
            {reviewMutation.isPending ? 'Reviewing…' : 'Review'}
          </Button>
        </div>
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
                className="flex w-full items-center justify-between text-left"
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

            {compareQuery.data && (
              <div className="mt-3 flex flex-col gap-2 text-xs">
                {compareQuery.data.title_changed && (
                  <p>
                    <span className="font-medium">Title:</span>{' '}
                    <span className="line-through text-[var(--muted-foreground)]">
                      {compareQuery.data.old_title}
                    </span>{' '}
                    → {compareQuery.data.new_title}
                  </p>
                )}
                <ul className="flex flex-col gap-1">
                  {compareQuery.data.steps.map((s) => (
                    <li
                      key={s.step_number}
                      className={
                        s.change === 'added'
                          ? 'text-emerald-700 dark:text-emerald-400'
                          : s.change === 'removed'
                            ? 'text-red-700 dark:text-red-400 line-through'
                            : s.change === 'modified'
                              ? 'text-amber-700 dark:text-amber-400'
                              : 'text-[var(--muted-foreground)]'
                      }
                    >
                      Step {s.step_number} ({s.change}): {s.new_action ?? s.old_action} →{' '}
                      {s.new_expected ?? s.old_expected}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function LinkedDefectsCard({ testCaseId }: { testCaseId: string }) {
  const defectsQuery = useQuery({
    queryKey: ['defects', 'by-test-case', testCaseId],
    queryFn: () => listDefects({ test_case_id: testCaseId }),
  })
  const defects = defectsQuery.data ?? []

  return (
    <Card>
      <CardHeader>
        <CardTitle>Linked Defects {defects.length > 0 && `(${defects.length})`}</CardTitle>
      </CardHeader>
      <CardContent>
        {defects.length === 0 ? (
          <p className="text-sm text-[var(--muted-foreground)]">No defects linked to this test case.</p>
        ) : (
          <ul className="flex flex-col gap-2 text-sm">
            {defects.map((d) => (
              <li key={d.id} className="flex items-center justify-between border-b border-[var(--border)] pb-2 last:border-0">
                <Link to={`/defects/${d.id}`} className="underline-offset-2 hover:underline">
                  {d.title}
                </Link>
                <Badge tone={STATUS_TONE[d.status]}>{d.status}</Badge>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
