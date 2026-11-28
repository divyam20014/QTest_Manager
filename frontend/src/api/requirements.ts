import { apiFetch } from '@/api/client'
import type { HistoryEntry } from '@/api/history'

/** ADR-148: fixed, unlike types and priorities. */
export type RequirementStatus = 'draft' | 'approved' | 'retired'

export interface Requirement {
  id: string
  project_id: string
  display_id: string | null
  requirement_type: string
  priority: string
  status: RequirementStatus
  owner_id: string | null
  owner_name: string | null
  acceptance_criteria: string[]
  /** ADR-150: linked test cases to look at again since the wording changed. */
  review_count: number
  /** ADR-136: send back as `expected_version` when changing it. */
  row_version: number
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
  /** ADR-150: the version the case was agreed to cover; null = linked before this was recorded. */
  covers_version_number: number | null
  needs_review: boolean
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
  acceptance_criteria: string[]
  created_by: string
  created_at: string
}

export interface RequirementCreateRequest {
  title: string
  description?: string
  task_id?: string | null
  requirement_type?: string
  priority?: string
  status?: RequirementStatus
  owner_id?: string | null
  acceptance_criteria?: string[]
}

/** `task_id: null` detaches the requirement from its task; changing only the task adds no version. */
export type RequirementUpdateRequest = Partial<RequirementCreateRequest> & { expected_version?: number }

export interface RequirementCoverageEntry {
  requirement_id: string
  display_id: string | null
  requirement_title: string
  status: RequirementStatus
  review_count: number
  linked_test_case_count: number
  covered: boolean
}

export interface RequirementCoverageReport {
  project_id: string
  total_requirements: number
  covered_requirements: number
  coverage_percentage: number
  /** Retired requirements are left out of the numbers above. */
  retired_requirements: number
  requirements_needing_review: number
  requirements: RequirementCoverageEntry[]
}

export interface RequirementListParams {
  page?: number
  page_size?: number
  task_id?: string
  include_sub_tasks?: boolean
  q?: string
  status?: RequirementStatus
  requirement_type?: string
  priority?: string
  owner_id?: string
  covered?: boolean
  needs_review?: boolean
}

export function listRequirements(projectId: string, params: RequirementListParams = {}): Promise<RequirementListResponse> {
  const query = new URLSearchParams()
  for (const key of ['q', 'status', 'requirement_type', 'priority', 'owner_id', 'covered', 'needs_review'] as const) {
    const value = params[key]
    if (value !== undefined && value !== '') query.set(key, String(value))
  }
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

/** `versionNumber` is the wording the person read; refused if it has changed since. */
export function confirmRequirementLink(requirementId: string, testCaseId: string, versionNumber: number): Promise<RequirementDetail> {
  return apiFetch<RequirementDetail>(`/requirements/${requirementId}/test-cases/${testCaseId}/confirm`, {
    method: 'POST',
    body: JSON.stringify({ version_number: versionNumber }),
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
