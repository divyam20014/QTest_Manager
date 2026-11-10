import { apiFetch } from '@/api/client'

export interface Requirement {
  id: string
  project_id: string
  title: string
  description: string
  version_number: number
  created_by: string
  created_at: string
  linked_test_case_count: number
}

export interface LinkedTestCase {
  test_case_id: string
  test_case_title: string
  test_case_status: string
  linked_by: string
  linked_at: string
}

export interface RequirementDetail extends Requirement {
  linked_test_cases: LinkedTestCase[]
}

export interface RequirementListResponse {
  items: Requirement[]
  total: number
}

export interface RequirementVersion {
  version_number: number
  title: string
  description: string
  created_by: string
  created_at: string
}

export interface RequirementCreateRequest {
  title: string
  description?: string
}

export type RequirementUpdateRequest = Partial<RequirementCreateRequest>

export interface RequirementCoverageEntry {
  requirement_id: string
  requirement_title: string
  linked_test_case_count: number
  covered: boolean
}

export interface RequirementCoverageReport {
  project_id: string
  total_requirements: number
  covered_requirements: number
  coverage_percentage: number
  requirements: RequirementCoverageEntry[]
}

export function listRequirements(
  projectId: string,
  params: { page?: number; page_size?: number } = {},
): Promise<RequirementListResponse> {
  const query = new URLSearchParams()
  if (params.page) query.set('page', String(params.page))
  if (params.page_size) query.set('page_size', String(params.page_size))
  const qs = query.toString()
  return apiFetch<RequirementListResponse>(
    `/projects/${projectId}/requirements${qs ? `?${qs}` : ''}`,
  )
}

export function getRequirement(id: string): Promise<RequirementDetail> {
  return apiFetch<RequirementDetail>(`/requirements/${id}`)
}

export function listRequirementVersions(id: string): Promise<RequirementVersion[]> {
  return apiFetch<RequirementVersion[]>(`/requirements/${id}/versions`)
}

export function createRequirement(
  projectId: string,
  req: RequirementCreateRequest,
): Promise<Requirement> {
  return apiFetch<Requirement>(`/projects/${projectId}/requirements`, {
    method: 'POST',
    body: JSON.stringify(req),
  })
}

export function updateRequirement(
  id: string,
  req: RequirementUpdateRequest,
): Promise<Requirement> {
  return apiFetch<Requirement>(`/requirements/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(req),
  })
}

export function deleteRequirement(id: string): Promise<{ deleted: boolean }> {
  return apiFetch<{ deleted: boolean }>(`/requirements/${id}`, { method: 'DELETE' })
}

export function linkTestCase(requirementId: string, testCaseId: string): Promise<RequirementDetail> {
  return apiFetch<RequirementDetail>(`/requirements/${requirementId}/test-cases`, {
    method: 'POST',
    body: JSON.stringify({ test_case_id: testCaseId }),
  })
}

export function unlinkTestCase(
  requirementId: string,
  testCaseId: string,
): Promise<RequirementDetail> {
  return apiFetch<RequirementDetail>(`/requirements/${requirementId}/test-cases/${testCaseId}`, {
    method: 'DELETE',
  })
}

export function getCoverageReport(projectId: string): Promise<RequirementCoverageReport> {
  return apiFetch<RequirementCoverageReport>(`/projects/${projectId}/requirements/coverage`)
}
