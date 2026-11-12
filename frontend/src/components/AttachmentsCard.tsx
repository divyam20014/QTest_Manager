import { useEffect, useRef, useState, type ChangeEvent, type DragEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import {
  attachmentDownloadUrl,
  deleteAttachment,
  fetchAttachmentBlobUrl,
  listAttachments,
  uploadAttachmentWithProgress,
  validateAttachmentFile,
  type Attachment,
  type AttachmentOwnerType,
} from '@/api/attachments'
import { ApiError } from '@/api/client'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog } from '@/components/ui/dialog'
import { useToast } from '@/lib/toast'

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

// Small in-memory thumbnail for image attachments. The download endpoint
// always forces Content-Disposition: attachment (intentional -- prevents
// stored-XSS-via-inline-render for arbitrary uploaded content), so a plain
// <img src={downloadUrl}> would trigger a save-file dialog instead of
// rendering. Fetching the bytes as an authenticated blob and handing the
// browser an object URL gets a real inline preview without touching that
// protection.
function AttachmentThumbnail({ attachment }: { attachment: Attachment }) {
  const [objectUrl, setObjectUrl] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    let urlToRevoke: string | null = null
    fetchAttachmentBlobUrl(attachment.id)
      .then((url) => {
        if (cancelled) {
          URL.revokeObjectURL(url)
          return
        }
        urlToRevoke = url
        setObjectUrl(url)
      })
      .catch(() => {
        /* Thumbnail is a nice-to-have; fall back to the generic file icon. */
      })
    return () => {
      cancelled = true
      if (urlToRevoke) URL.revokeObjectURL(urlToRevoke)
    }
  }, [attachment.id])

  if (!objectUrl) {
    return (
      <div className="flex size-10 shrink-0 items-center justify-center rounded-md border border-[var(--border)] bg-[var(--muted)] text-[10px] text-[var(--muted-foreground)]">
        …
      </div>
    )
  }
  return (
    <img
      src={objectUrl}
      alt=""
      className="size-10 shrink-0 rounded-md border border-[var(--border)] object-cover"
    />
  )
}

interface PendingUpload {
  key: string
  name: string
  progress: number
  error: string | null
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
  const { show: showToast } = useToast()
  const [isDraggingOver, setIsDraggingOver] = useState(false)
  const [pendingUploads, setPendingUploads] = useState<PendingUpload[]>([])
  const [deleteTarget, setDeleteTarget] = useState<Attachment | null>(null)

  const attachmentsQuery = useQuery({
    queryKey,
    queryFn: () => listAttachments(ownerType, ownerId),
  })

  const deleteMutation = useMutation({
    mutationFn: (attachmentId: string) => deleteAttachment(attachmentId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey })
      showToast('success', 'Attachment deleted')
      setDeleteTarget(null)
    },
    onError: () => showToast('error', 'Could not delete that attachment'),
  })

  async function uploadFiles(files: File[]) {
    if (files.length === 0) return

    const entries: PendingUpload[] = files.map((file) => ({
      key: `${file.name}-${file.size}-${Date.now()}-${Math.random()}`,
      name: file.name,
      progress: 0,
      error: null,
    }))
    setPendingUploads((prev) => [...prev, ...entries])

    let succeeded = 0
    let failed = 0

    await Promise.all(
      files.map(async (file, index) => {
        const entry = entries[index]
        const validationError = validateAttachmentFile(file)
        if (validationError) {
          failed += 1
          setPendingUploads((prev) =>
            prev.map((p) => (p.key === entry.key ? { ...p, error: validationError } : p)),
          )
          return
        }
        try {
          await uploadAttachmentWithProgress(ownerType, ownerId, file, (fraction) => {
            setPendingUploads((prev) =>
              prev.map((p) => (p.key === entry.key ? { ...p, progress: fraction } : p)),
            )
          })
          succeeded += 1
          setPendingUploads((prev) => prev.filter((p) => p.key !== entry.key))
        } catch (error) {
          failed += 1
          const message = error instanceof ApiError ? error.message : 'Upload failed'
          setPendingUploads((prev) =>
            prev.map((p) => (p.key === entry.key ? { ...p, error: message } : p)),
          )
        }
      }),
    )

    if (succeeded > 0) {
      queryClient.invalidateQueries({ queryKey })
      showToast('success', succeeded === 1 ? 'File uploaded' : `${succeeded} files uploaded`)
    }
    if (failed > 0 && succeeded > 0) {
      showToast('error', `${failed} of ${files.length} files failed to upload`)
    }
  }

  function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    if (files.length) void uploadFiles(files)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault()
    setIsDraggingOver(false)
    const files = Array.from(e.dataTransfer.files ?? [])
    if (files.length) void uploadFiles(files)
  }

  function dismissPendingError(key: string) {
    setPendingUploads((prev) => prev.filter((p) => p.key !== key))
  }

  return (
    <div>
      <div
        role="button"
        tabIndex={0}
        aria-label="Upload attachment: click or drag and drop a file here"
        onClick={() => fileInputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            fileInputRef.current?.click()
          }
        }}
        onDragOver={(e) => {
          e.preventDefault()
          setIsDraggingOver(true)
        }}
        onDragLeave={() => setIsDraggingOver(false)}
        onDrop={handleDrop}
        className={`mb-3 flex cursor-pointer flex-col items-center justify-center gap-1 rounded-md border-2 border-dashed px-4 py-5 text-center text-sm transition-colors ${
          isDraggingOver
            ? 'border-[var(--primary)] bg-[var(--muted)]'
            : 'border-[var(--border)] hover:bg-[var(--muted)]'
        }`}
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          id={`attachment-file-input-${ownerType}-${ownerId}`}
          onChange={handleFileChange}
        />
        <span className="font-medium">Drag and drop files here, or click to browse</span>
        <span className="text-xs text-[var(--muted-foreground)]">Multiple files supported</span>
      </div>

      {pendingUploads.map((p) => (
        <div key={p.key} className="mb-2 text-xs">
          <div className="mb-1 flex items-center justify-between gap-2">
            <span className="truncate">{p.name}</span>
            {p.error ? (
              <button
                type="button"
                onClick={() => dismissPendingError(p.key)}
                className="shrink-0 text-[var(--destructive)] underline-offset-2 hover:underline"
              >
                Dismiss
              </button>
            ) : (
              <span className="shrink-0 text-[var(--muted-foreground)]">
                {Math.round(p.progress * 100)}%
              </span>
            )}
          </div>
          {p.error ? (
            <p className="text-[var(--destructive)]">{p.error}</p>
          ) : (
            <div className="h-1.5 overflow-hidden rounded-full bg-[var(--muted)]">
              <div
                className="h-full rounded-full bg-[var(--primary)] transition-[width]"
                style={{ width: `${Math.round(p.progress * 100)}%` }}
              />
            </div>
          )}
        </div>
      ))}

      {attachmentsQuery.data?.length === 0 && pendingUploads.length === 0 && (
        <p className="text-sm text-[var(--muted-foreground)]">No attachments yet.</p>
      )}
      <ul className="flex flex-col gap-2 text-sm">
        {attachmentsQuery.data?.map((a) => (
          <li
            key={a.id}
            className="flex items-center justify-between gap-4 border-b border-[var(--border)] pb-2 last:border-0"
          >
            <div className="flex min-w-0 items-center gap-3">
              {a.mime_type.startsWith('image/') ? (
                <AttachmentThumbnail attachment={a} />
              ) : (
                <div className="flex size-10 shrink-0 items-center justify-center rounded-md border border-[var(--border)] bg-[var(--muted)] text-[10px] font-medium uppercase text-[var(--muted-foreground)]">
                  {a.file_name.split('.').pop()?.slice(0, 4) ?? 'file'}
                </div>
              )}
              <div className="min-w-0">
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
            </div>
            <Button variant="ghost" size="sm" onClick={() => setDeleteTarget(a)}>
              Delete
            </Button>
          </li>
        ))}
      </ul>

      <Dialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        title="Delete attachment"
      >
        <div className="flex flex-col gap-4 text-sm">
          <p className="text-[var(--muted-foreground)]">
            Delete {deleteTarget?.file_name}? This cannot be undone.
          </p>
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setDeleteTarget(null)}
              disabled={deleteMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              size="sm"
              disabled={deleteMutation.isPending}
              onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
            >
              {deleteMutation.isPending ? 'Deleting…' : 'Delete'}
            </Button>
          </div>
        </div>
      </Dialog>
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
