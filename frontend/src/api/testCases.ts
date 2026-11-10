import { apiFetch } from '@/api/client'
import type { HistoryEntry } from '@/api/history'

// Tier 5 / ADR-055: tenant-configurable value set, no longer a fixed
// literal union -- see the matching note on `Severity` in api/defects.ts.
export type Priority = string
export type TestCaseStatus = 'draft' | 'ready_for_review' | 'approved' | 'deprecated'
export type StepChangeType = 'unchanged' | 'added' | 'removed' | 'modified'

export interface StepIn {
  action: string
  expected: string
}

export interface StepOut {
  step_number: number
  action: string
  expected: string
}

export interface TestCase {
  id: string
  project_id: string
  title: string
  description: string
  priority: Priority
  status: TestCaseStatus
  status_label: string
  assignee_id: string | null
  module_id: string | null
  reviewer_id: string | null
  reviewer_name: string | null
  version_number: number
  created_by: string
  created_at: string
  steps: StepOut[]
  custom_fields: Record<string, unknown>
}

export interface TestCaseListResponse {
  items: TestCase[]
  total: number
}

export interface TestCaseListParams {
  search?: string
  priority?: Priority | ''
  status?: TestCaseStatus | ''
  assignee_id?: string | ''
  module_id?: string
  sort?: string
  page?: number
  page_size?: number
}

export interface TestCaseVersion {
  version_number: number
  title: string
  description: string
  approved_by: string | null
  approved_at: string | null
  created_by: string
  created_at: string
  steps: StepOut[]
}

export interface StepDiff {
  step_number: number
  change: StepChangeType
  old_action: string | null
  old_expected: string | null
  new_action: string | null
  new_expected: string | null
}

export interface VersionCompare {
  from_version: number
  to_version: number
  title_changed: boolean
  old_title: string
  new_title: string
  description_changed: boolean
  old_description: string
  new_description: string
  steps: StepDiff[]
}

export interface TestCaseCreateRequest {
  title: string
  description?: string
  priority: Priority
  assignee_id?: string | null
  steps: StepIn[]
}

export type TestCaseUpdateRequest = Partial<TestCaseCreateRequest>

export function listTestCases(
  projectId: string,
  params: TestCaseListParams = {},
): Promise<TestCaseListResponse> {
  const query = new URLSearchParams()
  if (params.search) query.set('search', params.search)
  if (params.priority) query.set('priority', params.priority)
  if (params.status) query.set('status', params.status)
  if (params.assignee_id) query.set('assignee_id', params.assignee_id)
  if (params.module_id) query.set('module_id', params.module_id)
  if (params.sort) query.set('sort', params.sort)
  if (params.page) query.set('page', String(params.page))
  if (params.page_size) query.set('page_size', String(params.page_size))
  const qs = query.toString()
  return apiFetch<TestCaseListResponse>(`/projects/${projectId}/test-cases${qs ? `?${qs}` : ''}`)
}

export function getTestCase(id: string): Promise<TestCase> {
  return apiFetch<TestCase>(`/test-cases/${id}`)
}

export function listTestCaseVersions(id: string): Promise<TestCaseVersion[]> {
  return apiFetch<TestCaseVersion[]>(`/test-cases/${id}/versions`)
}

export function getTestCaseHistory(id: string): Promise<HistoryEntry[]> {
  return apiFetch<HistoryEntry[]>(`/test-cases/${id}/history`)
}

export function compareTestCaseVersions(
  id: string,
  fromVersion: number,
  toVersion: number,
): Promise<VersionCompare> {
  return apiFetch<VersionCompare>(
    `/test-cases/${id}/versions/compare?from=${fromVersion}&to=${toVersion}`,
  )
}

export function createTestCase(projectId: string, req: TestCaseCreateRequest): Promise<TestCase> {
  return apiFetch<TestCase>(`/projects/${projectId}/test-cases`, {
    method: 'POST',
    body: JSON.stringify(req),
  })
}

export function updateTestCase(id: string, req: TestCaseUpdateRequest): Promise<TestCase> {
  return apiFetch<TestCase>(`/test-cases/${id}`, { method: 'PATCH', body: JSON.stringify(req) })
}

export function submitForReview(id: string, reviewerId?: string | null): Promise<TestCase> {
  return apiFetch<TestCase>(`/test-cases/${id}/submit-review`, {
    method: 'POST',
    body: JSON.stringify({ reviewer_id: reviewerId ?? null }),
  })
}

export function approveTestCase(id: string): Promise<TestCase> {
  return apiFetch<TestCase>(`/test-cases/${id}/approve`, { method: 'POST' })
}

export function requestChanges(id: string, comment: string): Promise<TestCase> {
  return apiFetch<TestCase>(`/test-cases/${id}/request-changes`, {
    method: 'POST',
    body: JSON.stringify({ comment }),
  })
}

export function assignModule(id: string, moduleId: string | null): Promise<{ assigned: boolean }> {
  return apiFetch<{ assigned: boolean }>(`/test-cases/${id}/module`, {
    method: 'POST',
    body: JSON.stringify({ module_id: moduleId }),
  })
}

export function deprecateTestCase(id: string): Promise<TestCase> {
  return apiFetch<TestCase>(`/test-cases/${id}/deprecate`, { method: 'POST' })
}

export function deleteTestCase(id: string): Promise<{ deleted: boolean }> {
  return apiFetch<{ deleted: boolean }>(`/test-cases/${id}`, { method: 'DELETE' })
}
