import { API_BASE_URL, apiFetch } from '@/api/client'

export interface Attachment {
  id: string
  file_name: string
  mime_type: string
  size_bytes: number
  uploaded_by: string
  uploaded_by_name: string | null
  uploaded_at: string
}

export function listAttachments(testCaseId: string): Promise<Attachment[]> {
  return apiFetch<Attachment[]>(`/test-cases/${testCaseId}/attachments`)
}

export function uploadAttachment(testCaseId: string, file: File): Promise<Attachment> {
  const formData = new FormData()
  formData.append('file', file)
  return apiFetch<Attachment>(`/test-cases/${testCaseId}/attachments`, {
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
