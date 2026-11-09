import { apiFetch } from '@/api/client'

export type Severity = 'Low' | 'Medium' | 'High' | 'Critical'
export type DefectStatus = 'New' | 'Open' | 'Fixed' | 'Verified' | 'Closed'
export type Verdict = 'pass' | 'fail' | 'ignore'

export interface DefectLink {
  id: string
  linkable_type: 'execution_step' | 'test_case' | 'defect'
  linkable_id: string
  link_type: 'relates_to' | 'duplicate_of' | 'caused_by'
  created_at: string
}

export interface ExecutionEvidence {
  execution_step_id: string
  test_run_case_id: string
  verdict: Verdict | null
  opened_at: string | null
  closed_at: string | null
  duration_ms: number | null
  executed_by: string | null
  executed_by_name: string | null
}

export interface Defect {
  id: string
  project_id: string
  project_name: string
  test_case_id: string | null
  test_case_title: string | null
  test_case_version_id: string | null
  test_case_version_number: number | null
  test_run_id: string | null
  test_run_name: string | null
  test_run_case_id: string | null
  test_case_version_step_id: string | null
  step_number: number | null
  title: string
  severity: Severity
  status: DefectStatus
  description: string | null
  actual_result: string | null
  expected_result: string | null
  environment: string | null
  reported_by: string
  reported_by_name: string | null
  created_at: string
  closed_at: string | null
  links: DefectLink[]
  execution_evidence: ExecutionEvidence | null
}

export interface DefectHistoryEntry {
  id: string
  action: string
  user_id: string | null
  user_name: string | null
  event_metadata: Record<string, unknown>
  created_at: string
}

export interface DefectCreateRequest {
  execution_step_id?: string
  project_id?: string
  test_run_id?: string
  title?: string
  severity: Severity
  description?: string
  actual_result?: string
  expected_result?: string
  environment?: string
}

export interface DefectLinkCreateRequest {
  linkable_type: 'execution_step' | 'test_case' | 'defect'
  linkable_id: string
  link_type?: 'relates_to' | 'duplicate_of' | 'caused_by'
}

export interface DefectFilters {
  project_id?: string
  status?: DefectStatus
  severity?: Severity
  test_run_id?: string
  reported_by?: string
  created_from?: string
  created_to?: string
  test_case_id?: string
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

export function getDefectHistory(id: string): Promise<DefectHistoryEntry[]> {
  return apiFetch<DefectHistoryEntry[]>(`/defects/${id}/history`)
}

export function createDefect(req: DefectCreateRequest): Promise<Defect> {
  return apiFetch<Defect>('/defects', { method: 'POST', body: JSON.stringify(req) })
}

export function updateDefectStatus(
  id: string,
  status: DefectStatus,
  verificationConfirmed = false,
): Promise<Defect> {
  return apiFetch<Defect>(`/defects/${id}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status, verification_confirmed: verificationConfirmed }),
  })
}

export function addDefectLink(id: string, req: DefectLinkCreateRequest): Promise<Defect> {
  return apiFetch<Defect>(`/defects/${id}/links`, { method: 'POST', body: JSON.stringify(req) })
}
