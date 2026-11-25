import { apiFetch } from '@/api/client'
import type { HistoryEntry } from '@/api/history'

export interface Requirement {
  id: string
  project_id: string
  title: string
  description: string
  version_number: number
  created_by: string
  created_at: string
  linked_test_case_count: number
  /** ADR-127: the task this requirement belongs to, if any. */
  task_id: string | null
  task_display_id: string | null
  task_title: string | null
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
  task_id?: string | null
}

/** `task_id: null` detaches the requirement from its task; changing only the task adds no version. */
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
  params: { page?: number; page_size?: number; task_id?: string; include_sub_tasks?: boolean } = {},
): Promise<RequirementListResponse> {
  const query = new URLSearchParams()
  if (params.task_id) query.set('task_id', params.task_id)
  if (params.task_id && params.include_sub_tasks) query.set('include_sub_tasks', 'true')
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

export function getRequirementHistory(id: string): Promise<HistoryEntry[]> {
  return apiFetch<HistoryEntry[]>(`/requirements/${id}/history`)
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

/** `summary` asks for the totals only (`requirements` comes back empty): the dashboard widget needs no rows. */
/** Optionally for one task (`task_id`), with its sub-tasks (`include_sub_tasks`). */
export function getCoverageReport(
  projectId: string,
  summary = false,
  scope: { task_id?: string; include_sub_tasks?: boolean } = {},
): Promise<RequirementCoverageReport> {
  const query = new URLSearchParams()
  if (summary) query.set('summary', 'true')
  if (scope.task_id) {
    query.set('task_id', scope.task_id)
    if (scope.include_sub_tasks) query.set('include_sub_tasks', 'true')
  }
  const qs = query.toString()
  return apiFetch<RequirementCoverageReport>(`/projects/${projectId}/requirements/coverage${qs ? `?${qs}` : ''}`)
}
