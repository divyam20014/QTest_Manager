import { API_BASE_URL, apiFetch } from '@/api/client'

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

export function deleteAttachment(attachmentId: string): Promise<{ deleted: boolean }> {
  return apiFetch<{ deleted: boolean }>(`/attachments/${attachmentId}`, { method: 'DELETE' })
}

export function attachmentDownloadUrl(attachmentId: string): string {
  return `${API_BASE_URL}/attachments/${attachmentId}/download`
}
