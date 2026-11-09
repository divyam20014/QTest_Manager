import { API_BASE_URL, apiFetch } from '@/api/client'

export interface ImportRowResult {
  row_number: number
  status: string
  test_case_id: string | null
  errors: string[]
}

export interface ImportReport {
  total_rows: number
  created_count: number
  error_count: number
  rows: ImportRowResult[]
}

export function importTestCases(file: File): Promise<ImportReport> {
  const formData = new FormData()
  formData.append('file', file)
  return apiFetch<ImportReport>('/test-cases/import', { method: 'POST', body: formData })
}

export const templateDownloadUrl = `${API_BASE_URL}/test-cases/import/template.csv`

export function exportUrl(projectId: string): string {
  return `${API_BASE_URL}/projects/${projectId}/test-cases/export.csv`
}
