import { useRef, useState, type ChangeEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useParams } from 'react-router-dom'

import {
  attachmentDownloadUrl,
  deleteAttachment,
  listAttachments,
  uploadAttachment,
} from '@/api/attachments'
import { ApiError } from '@/api/client'
import {
  approveTestCase,
  deleteTestCase,
  getTestCase,
  listTestCaseVersions,
  submitForReview,
  updateTestCase,
  type TestCaseUpdateRequest,
} from '@/api/testCases'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog } from '@/components/ui/dialog'
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
    mutationFn: async (action: 'submit' | 'approve' | 'delete'): Promise<unknown> => {
      if (action === 'submit') return submitForReview(testCaseId!)
      if (action === 'approve') return approveTestCase(testCaseId!)
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

  const formValues: TestCaseFormValues = {
    title: testCase.title,
    priority: testCase.priority,
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

        <Card>
          <CardHeader>
            <CardTitle>Version History</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col gap-2 text-sm">
              {versionsQuery.data?.map((v) => (
                <li key={v.version_number} className="border-b border-[var(--border)] pb-2 last:border-0">
                  <p className="font-medium">v{v.version_number}</p>
                  <p className="text-xs text-[var(--muted-foreground)]">
                    {v.approved_at ? `Approved ${new Date(v.approved_at).toLocaleDateString()}` : 'Not approved'}
                  </p>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>

      <AttachmentsCard testCaseId={testCase.id} />

      <Dialog open={editOpen} onClose={() => setEditOpen(false)} title="Edit Test Case" className="max-w-2xl">
        <TestCaseForm
          defaultValues={formValues}
          submitLabel="Save Changes"
          isSubmitting={updateMutation.isPending}
          serverError={updateError}
          onSubmit={(values) => updateMutation.mutate(values)}
        />
      </Dialog>
    </div>
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
