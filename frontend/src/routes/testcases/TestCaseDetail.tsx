import { useRef, useState, type ChangeEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { Link, useNavigate, useParams } from 'react-router-dom'

import {
  attachmentDownloadUrl,
  deleteAttachment,
  listAttachments,
  uploadAttachment,
} from '@/api/attachments'
import { ApiError } from '@/api/client'
import { listDefects } from '@/api/defects'
import { STATUS_TONE } from '@/routes/defects/statusDisplay'
import {
  approveTestCase,
  compareTestCaseVersions,
  deleteTestCase,
  deprecateTestCase,
  getTestCase,
  listTestCaseVersions,
  submitForReview,
  updateTestCase,
  type TestCaseUpdateRequest,
  type TestCaseVersion,
} from '@/api/testCases'
import { listUsers } from '@/api/users'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { useAuth } from '@/lib/auth'
import { TestCaseForm, type TestCaseFormValues } from './TestCaseForm'
import { STATUS_DISPLAY } from './statusDisplay'

export function TestCaseDetail() {
  const { testCaseId } = useParams<{ testCaseId: string }>()
  const { user } = useAuth()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [editOpen, setEditOpen] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

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

  const runAction = useMutation({
    mutationFn: async (action: 'submit' | 'approve' | 'deprecate' | 'delete'): Promise<unknown> => {
      if (action === 'submit') return submitForReview(testCaseId!)
      if (action === 'approve') return approveTestCase(testCaseId!)
      if (action === 'deprecate') return deprecateTestCase(testCaseId!)
      return deleteTestCase(testCaseId!)
    },
    onSuccess: (_, action) => {
      setActionError(null)
      if (action === 'delete') {
        navigate(`/projects/${testCase!.project_id}/test-cases`)
        return
      }
      invalidate()
    },
    onError: (err) => setActionError(err instanceof ApiError ? err.message : 'Something went wrong'),
  })

  const testCase = caseQuery.data
  if (caseQuery.isLoading) return <p className="text-sm text-[var(--muted-foreground)]">Loading…</p>
  if (caseQuery.isError || !testCase) return <p className="text-sm text-[var(--destructive)]">Test case not found.</p>

  const canApprove = user?.role === 'admin' || user?.role === 'manager'
  const updateError = updateMutation.error instanceof ApiError ? updateMutation.error.message : null
  const usersById = new Map((usersQuery.data ?? []).map((u) => [u.id, u.name]))

  const formValues: TestCaseFormValues = {
    title: testCase.title,
    description: testCase.description,
    priority: testCase.priority,
    assignee_id: testCase.assignee_id ?? '',
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
      </div>

      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
          Edit
        </Button>
        {testCase.status === 'draft' && (
          <Button size="sm" onClick={() => runAction.mutate('submit')} disabled={runAction.isPending}>
            Submit for Review
          </Button>
        )}
        {testCase.status === 'ready_for_review' && canApprove && (
          <Button size="sm" onClick={() => runAction.mutate('approve')} disabled={runAction.isPending}>
            Approve
          </Button>
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
      <AttachmentsCard testCaseId={testCase.id} />

      <Dialog open={editOpen} onClose={() => setEditOpen(false)} title="Edit Test Case" className="max-w-2xl">
        <TestCaseForm
          defaultValues={formValues}
          submitLabel="Save Changes"
          isSubmitting={updateMutation.isPending}
          serverError={updateError}
          users={usersQuery.data ?? []}
          onSubmit={(values) => updateMutation.mutate(values)}
        />
      </Dialog>
    </div>
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

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function AttachmentsCard({ testCaseId }: { testCaseId: string }) {
  const queryClient = useQueryClient()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const attachmentsQuery = useQuery({
    queryKey: ['test-cases', 'attachments', testCaseId],
    queryFn: () => listAttachments(testCaseId),
  })

  const uploadMutation = useMutation({
    mutationFn: (file: File) => uploadAttachment(testCaseId, file),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['test-cases', 'attachments', testCaseId] }),
  })

  const deleteMutation = useMutation({
    mutationFn: (attachmentId: string) => deleteAttachment(attachmentId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['test-cases', 'attachments', testCaseId] }),
  })

  const uploadError = uploadMutation.error instanceof ApiError ? uploadMutation.error.message : null

  function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) uploadMutation.mutate(file)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Attachments</CardTitle>
          <div>
            <input ref={fileInputRef} type="file" className="hidden" id="attachment-file-input" onChange={handleFileChange} />
            <Button
              size="sm"
              variant="outline"
              disabled={uploadMutation.isPending}
              onClick={() => fileInputRef.current?.click()}
            >
              {uploadMutation.isPending ? 'Uploading…' : 'Upload File'}
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {uploadError && <p className="mb-2 text-xs text-[var(--destructive)]">{uploadError}</p>}
        {attachmentsQuery.data?.length === 0 && (
          <p className="text-sm text-[var(--muted-foreground)]">No attachments yet.</p>
        )}
        <ul className="flex flex-col gap-2 text-sm">
          {attachmentsQuery.data?.map((a) => (
            <li
              key={a.id}
              className="flex items-center justify-between gap-4 border-b border-[var(--border)] pb-2 last:border-0"
            >
              <div>
                <a
                  href={attachmentDownloadUrl(a.id)}
                  className="font-medium underline-offset-2 hover:underline"
                  target="_blank"
                  rel="noreferrer"
                >
                  {a.file_name}
                </a>
                <p className="text-xs text-[var(--muted-foreground)]">
                  {formatBytes(a.size_bytes)} · uploaded by {a.uploaded_by_name ?? 'Unknown'} on{' '}
                  {new Date(a.uploaded_at).toLocaleDateString()}
                </p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                disabled={deleteMutation.isPending}
                onClick={() => deleteMutation.mutate(a.id)}
              >
                Delete
              </Button>
            </li>
          ))}
        </ul>
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
