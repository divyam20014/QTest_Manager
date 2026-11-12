import { API_BASE_URL, ApiError, apiFetch } from '@/api/client'

export type AttachmentOwnerType = 'test_case' | 'defect' | 'execution_step' | 'requirement'

export interface Attachment {
  id: string
  file_name: string
  mime_type: string
  size_bytes: number
  uploaded_by: string
  uploaded_by_name: string | null
  uploaded_at: string
}

const OWNER_PATH_SEGMENT: Record<AttachmentOwnerType, string> = {
  test_case: 'test-cases',
  defect: 'defects',
  execution_step: 'execution-steps',
  requirement: 'requirements',
}

// Mirrors attachment_service.ALLOWED_ATTACHMENT_EXTENSIONS /
// settings.attachment_max_bytes on the backend -- this is purely for
// instant client-side feedback before a network round-trip; the server's
// own allowlist + magic-byte content check (GAP-66) is the real,
// authoritative gate. Keep these two lists in sync by hand if either side
// changes.
export const ALLOWED_ATTACHMENT_EXTENSIONS = [
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp',
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.csv', '.txt', '.log',
]
export const ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024

export function validateAttachmentFile(file: File): string | null {
  const extension = `.${file.name.split('.').pop()?.toLowerCase() ?? ''}`
  if (!ALLOWED_ATTACHMENT_EXTENSIONS.includes(extension)) {
    return `File type '${extension}' is not allowed. Allowed types: ${ALLOWED_ATTACHMENT_EXTENSIONS.join(', ')}`
  }
  if (file.size > ATTACHMENT_MAX_BYTES) {
    return `Attachment exceeds the ${ATTACHMENT_MAX_BYTES / (1024 * 1024)}MB limit`
  }
  if (file.size === 0) {
    return 'Attachment file is empty'
  }
  return null
}

export function listAttachments(
  ownerType: AttachmentOwnerType,
  ownerId: string,
): Promise<Attachment[]> {
  return apiFetch<Attachment[]>(`/${OWNER_PATH_SEGMENT[ownerType]}/${ownerId}/attachments`)
}

export function uploadAttachment(
  ownerType: AttachmentOwnerType,
  ownerId: string,
  file: File,
): Promise<Attachment> {
  const formData = new FormData()
  formData.append('file', file)
  return apiFetch<Attachment>(`/${OWNER_PATH_SEGMENT[ownerType]}/${ownerId}/attachments`, {
    method: 'POST',
    body: formData,
  })
}

// `fetch` has no upload-progress event, so real per-file progress needs
// XMLHttpRequest specifically for this one call rather than the shared
// `apiFetch` helper above.
export function uploadAttachmentWithProgress(
  ownerType: AttachmentOwnerType,
  ownerId: string,
  file: File,
  onProgress: (fraction: number) => void,
): Promise<Attachment> {
  return new Promise((resolve, reject) => {
    const formData = new FormData()
    formData.append('file', file)
    const xhr = new XMLHttpRequest()
    xhr.open('POST', `${API_BASE_URL}/${OWNER_PATH_SEGMENT[ownerType]}/${ownerId}/attachments`)
    xhr.withCredentials = true
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(event.loaded / event.total)
    }
    xhr.onerror = () => reject(new ApiError('Network error during upload', 'network_error'))
    xhr.onload = () => {
      let body: { data: Attachment | null; error: { code: string; message: string } | null }
      try {
        body = JSON.parse(xhr.responseText)
      } catch {
        reject(new ApiError('Upload failed', 'unknown'))
        return
      }
      if (xhr.status >= 200 && xhr.status < 300 && !body.error && body.data) {
        resolve(body.data)
      } else {
        reject(new ApiError(body.error?.message ?? 'Upload failed', body.error?.code ?? 'unknown'))
      }
    }
    xhr.send(formData)
  })
}

export function deleteAttachment(attachmentId: string): Promise<{ deleted: boolean }> {
  return apiFetch<{ deleted: boolean }>(`/attachments/${attachmentId}`, { method: 'DELETE' })
}

export function attachmentDownloadUrl(attachmentId: string): string {
  return `${API_BASE_URL}/attachments/${attachmentId}/download`
}

export async function fetchAttachmentBlobUrl(attachmentId: string): Promise<string> {
  const response = await fetch(attachmentDownloadUrl(attachmentId), { credentials: 'include' })
  if (!response.ok) throw new ApiError('Could not load preview', 'unknown')
  const blob = await response.blob()
  return URL.createObjectURL(blob)
}
