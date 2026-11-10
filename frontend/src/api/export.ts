import { API_BASE_URL, apiFetch } from '@/api/client'

export type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed'

export interface ExportJob {
  id: string
  job_type: string
  status: JobStatus
  error: string | null
  result: { manifest: Record<string, number>; size_bytes: number } | null
  created_at: string
  started_at: string | null
  finished_at: string | null
}

export function requestExport(): Promise<{ job_id: string; status: JobStatus }> {
  return apiFetch<{ job_id: string; status: JobStatus }>('/export', { method: 'POST' })
}

export function getExportJob(jobId: string): Promise<ExportJob> {
  return apiFetch<ExportJob>(`/export/jobs/${jobId}`)
}

// Binary download, not the JSON envelope apiFetch expects -- fetched
// directly and handed to the browser as a Blob, same pattern the CSV
// import error-report download already uses.
export async function downloadExport(jobId: string): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/export/jobs/${jobId}/download`, {
    credentials: 'include',
  })
  if (!response.ok) {
    throw new Error('Export download failed')
  }
  const blob = await response.blob()
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `qtesthub-export-${jobId}.zip`
  link.click()
  URL.revokeObjectURL(url)
}
