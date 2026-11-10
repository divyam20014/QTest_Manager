import { useRef, type ChangeEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import {
  attachmentDownloadUrl,
  deleteAttachment,
  listAttachments,
  uploadAttachment,
  type AttachmentOwnerType,
} from '@/api/attachments'
import { ApiError } from '@/api/client'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

// Phase 7 (AI/SaaS vision roadmap, GAP-75): the same polymorphic attachment
// pattern Test Case already used, now reusable for Defect and
// ExecutionStep owners too -- wires up the `owner_type` headroom that
// already existed in the backend schema/CHECK constraint.
export function AttachmentsPanel({
  ownerType,
  ownerId,
}: {
  ownerType: AttachmentOwnerType
  ownerId: string
}) {
  const queryClient = useQueryClient()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const queryKey = ['attachments', ownerType, ownerId]

  const attachmentsQuery = useQuery({
    queryKey,
    queryFn: () => listAttachments(ownerType, ownerId),
  })

  const uploadMutation = useMutation({
    mutationFn: (file: File) => uploadAttachment(ownerType, ownerId, file),
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
  })

  const deleteMutation = useMutation({
    mutationFn: (attachmentId: string) => deleteAttachment(attachmentId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
  })

  const uploadError = uploadMutation.error instanceof ApiError ? uploadMutation.error.message : null

  function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) uploadMutation.mutate(file)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          id={`attachment-file-input-${ownerType}-${ownerId}`}
          onChange={handleFileChange}
        />
        <Button
          size="sm"
          variant="outline"
          disabled={uploadMutation.isPending}
          onClick={() => fileInputRef.current?.click()}
        >
          {uploadMutation.isPending ? 'Uploading…' : 'Upload File'}
        </Button>
      </div>
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
    </div>
  )
}

export function AttachmentsCard({
  ownerType,
  ownerId,
  title = 'Attachments',
}: {
  ownerType: AttachmentOwnerType
  ownerId: string
  title?: string
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <AttachmentsPanel ownerType={ownerType} ownerId={ownerId} />
      </CardContent>
    </Card>
  )
}
