import { apiFetch } from '@/api/client'

export type Severity = 'Low' | 'Medium' | 'High' | 'Critical'
export type DefectStatus = 'New' | 'Open' | 'Fixed' | 'Verified' | 'Closed'

export interface DefectLink {
  id: string
  linkable_type: 'execution_step' | 'test_case' | 'defect'
  linkable_id: string
  link_type: 'relates_to' | 'duplicate_of' | 'caused_by'
  created_at: string
}

export interface Defect {
  id: string
  project_id: string
  project_name: string
  test_case_id: string | null
  test_case_title: string | null
  test_case_version_id: string | null
  test_run_id: string | null
  test_run_name: string | null
  test_case_version_step_id: string | null
  step_number: number | null
  title: string
  severity: Severity
  status: DefectStatus
  description: string | null
  reported_by: string
  created_at: string
  closed_at: string | null
  links: DefectLink[]
}

export interface DefectCreateRequest {
  execution_step_id?: string
  project_id?: string
  title?: string
  severity: Severity
  description?: string
}

export interface DefectFilters {
  project_id?: string
  status?: DefectStatus
  severity?: Severity
  test_run_id?: string
}

export function listDefects(filters: DefectFilters = {}): Promise<Defect[]> {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(filters)) {
    if (value) params.set(key, value)
  }
  const query = params.toString()
  return apiFetch<Defect[]>(`/defects${query ? `?${query}` : ''}`)
}

export function getDefect(id: string): Promise<Defect> {
  return apiFetch<Defect>(`/defects/${id}`)
}

export function createDefect(req: DefectCreateRequest): Promise<Defect> {
  return apiFetch<Defect>('/defects', { method: 'POST', body: JSON.stringify(req) })
}

export function updateDefectStatus(id: string, status: DefectStatus): Promise<Defect> {
  return apiFetch<Defect>(`/defects/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) })
}
