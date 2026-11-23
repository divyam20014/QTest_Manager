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
  /** Optional per-step test data. */
  test_data?: string | null
}

export interface StepOut {
  step_number: number
  action: string
  expected: string
  test_data?: string | null
}

/** ADR-115: automation status is a fixed enum, not a tenant option set. */
export const AUTOMATION_STATUSES = ['Manual', 'Automated', 'Candidate for Automation'] as const
export type AutomationStatus = (typeof AUTOMATION_STATUSES)[number]

/** ADR-116: derived from the latest executed run case; never stored on the test case. */
export type ExecutionStatus = 'Pass' | 'Fail' | 'Blocked' | 'Skipped' | 'Not Run'
export const EXECUTION_STATUSES: ExecutionStatus[] = ['Pass', 'Fail', 'Blocked', 'Skipped', 'Not Run']

export interface LinkedDefect {
  id: string
  display_id: string | null
  title: string
  status: string
}

export interface TestCase {
  id: string
  project_id: string
  title: string
  description: string
  priority: Priority
  status: TestCaseStatus
  status_label: string
  /** Same value as `status`; the product label is "Review Status". */
  review_status: TestCaseStatus
  review_status_label: string
  assignee_id: string | null
  module_id: string | null
  module_name: string | null
  /** "Module/Submodule/Feature". */
  module_path: string | null
  reviewer_id: string | null
  reviewer_name: string | null
  version_number: number
  created_by: string
  created_by_name: string | null
  created_at: string
  steps: StepOut[]
  custom_fields: Record<string, unknown>
  scenario_id: string | null
  scenario_description: string | null
  prerequisite: string | null
  preconditions: string | null
  test_data: string | null
  test_data_format: 'json' | 'text' | null
  // Pass 2: NOT editable -- derived read-only from the most recent real
  // execution of this test case across any test run. Absent (null) if
  // never executed.
  last_execution_result: string | null
  last_executed_by_name: string | null
  last_execution_date: string | null
  execution_status: ExecutionStatus
  last_executed_by: string | null
  last_executed_by_id: string | null
  last_executed_at: string | null
  last_actual_result: string | null
  linked_defects: LinkedDefect[]
  linked_defect_count: number
  attachment_count: number
  comment_count: number
  display_id: string | null
  test_type: string | null
  severity: string | null
  automation_status: AutomationStatus | null
  environment: string | null
  requirement_ref: string | null
  postconditions: string | null
  expected_result: string | null
  quarantined: boolean
  quarantine_reason: string | null
  quarantined_at: string | null
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
  quarantined?: 'any' | 'only' | 'exclude'
  test_type?: string
  severity?: string
  automation_status?: string
  environment?: string
  execution_status?: string
  executed_by?: string
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
  module_id?: string | null
  description?: string
  priority: Priority
  assignee_id?: string | null
  steps: StepIn[]
  scenario_id?: string | null
  scenario_description?: string | null
  /** `prerequisite` is the legacy name of this field. */
  preconditions?: string | null
  test_data?: string | null
  /** 'json' makes the API reject malformed JSON; 'auto'/'text' accept any text. */
  test_data_format?: 'auto' | 'json' | 'text'
  expected_result?: string | null
  postconditions?: string | null
  test_type?: string | null
  severity?: string | null
  automation_status?: AutomationStatus | null
  environment?: string | null
  requirement_ref?: string | null
}

export type TestCaseUpdateRequest = Partial<TestCaseCreateRequest>

const FILTER_KEYS = [
  'test_type',
  'severity',
  'automation_status',
  'environment',
  'execution_status',
  'executed_by',
] as const

export function testCaseQuery(params: TestCaseListParams = {}, includeQuarantine = true): string {
  const query = new URLSearchParams()
  if (params.search) query.set('search', params.search)
  if (params.priority) query.set('priority', params.priority)
  if (params.status) query.set('status', params.status)
  if (params.assignee_id) query.set('assignee_id', params.assignee_id)
  if (params.module_id) query.set('module_id', params.module_id)
  if (includeQuarantine && params.quarantined && params.quarantined !== 'any') {
    query.set('quarantined', params.quarantined)
  }
  for (const key of FILTER_KEYS) {
    const value = params[key]
    if (value) query.set(key, value)
  }
  if (params.sort) query.set('sort', params.sort)
  if (params.page) query.set('page', String(params.page))
  if (params.page_size) query.set('page_size', String(params.page_size))
  return query.toString()
}

export function listTestCases(
  projectId: string,
  params: TestCaseListParams = {},
): Promise<TestCaseListResponse> {
  const qs = testCaseQuery(params)
  return apiFetch<TestCaseListResponse>(`/projects/${projectId}/test-cases${qs ? `?${qs}` : ''}`)
}

// ADR-077: the same listing across every project the caller may see; each item
// carries its `project_id`. Replaces asking each project separately when a filter is on.
export function listAllTestCases(params: TestCaseListParams = {}): Promise<TestCaseListResponse> {
  const qs = testCaseQuery(params, false)
  return apiFetch<TestCaseListResponse>(`/test-cases${qs ? `?${qs}` : ''}`)
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

export function quarantineTestCase(id: string, reason: string): Promise<TestCase> {
  return apiFetch<TestCase>(`/test-cases/${id}/quarantine`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  })
}

export function unquarantineTestCase(id: string): Promise<TestCase> {
  return apiFetch<TestCase>(`/test-cases/${id}/unquarantine`, { method: 'POST' })
}

export function deprecateTestCase(id: string): Promise<TestCase> {
  return apiFetch<TestCase>(`/test-cases/${id}/deprecate`, { method: 'POST' })
}

export function deleteTestCase(id: string): Promise<{ deleted: boolean }> {
  return apiFetch<{ deleted: boolean }>(`/test-cases/${id}`, { method: 'DELETE' })
}

export interface BulkUpdateResult {
  updated: number
  failed: number
  results: { test_case_id: string; ok: boolean; error: string | null }[]
}

/**
 * ADR-070: bulk priority/assignee change. Only keys that are present are
 * applied -- `assignee_id: null` unassigns, omitting it leaves the assignee
 * alone. Never creates a new version or un-approves a case.
 */
export function bulkUpdateTestCases(req: {
  test_case_ids: string[]
  priority?: string
  assignee_id?: string | null
}): Promise<BulkUpdateResult> {
  return apiFetch<BulkUpdateResult>('/test-cases/bulk-update', {
    method: 'POST',
    body: JSON.stringify(req),
  })
}

export interface LinkedRequirement {
  id: string
  title: string
}

export function listLinkedRequirements(testCaseId: string): Promise<LinkedRequirement[]> {
  return apiFetch<LinkedRequirement[]>(`/test-cases/${testCaseId}/requirements`)
}

// ---------------------------------------------------------------------------
// ADR-115 / ADR-116: 22-field metadata, executions history, duplicate
// ---------------------------------------------------------------------------

export interface TestCaseFieldSpec {
  key: string
  label: string
  type: string
  group: string
  sortable: boolean
  filterable: boolean
  editable: boolean
  mandatory_on_create: boolean
  default_visible: boolean
}

export interface TestCaseFieldCatalog {
  fields: TestCaseFieldSpec[]
  default_columns: string[]
  sortable: string[]
  filters: string[]
  automation_statuses: string[]
  execution_statuses: string[]
}

export function getTestCaseColumns(): Promise<TestCaseFieldCatalog> {
  return apiFetch<TestCaseFieldCatalog>('/test-cases/columns')
}

export interface TestCaseExecution {
  test_run_case_id: string
  test_run_id: string
  run_name: string
  run_type: string
  run_finished: boolean
  executed_at: string | null
  executed_by_id: string | null
  executed_by_name: string | null
  status: string
  execution_status: ExecutionStatus
  actual_result: string | null
  blocked_reason: string | null
  version_number: number
  defects: LinkedDefect[]
}

export interface TestCaseExecutionList {
  items: TestCaseExecution[]
  total: number
}

export function listTestCaseExecutions(
  id: string,
  params: { page?: number; page_size?: number } = {},
): Promise<TestCaseExecutionList> {
  const query = new URLSearchParams()
  if (params.page) query.set('page', String(params.page))
  if (params.page_size) query.set('page_size', String(params.page_size))
  const qs = query.toString()
  return apiFetch<TestCaseExecutionList>(`/test-cases/${id}/executions${qs ? `?${qs}` : ''}`)
}

export function duplicateTestCase(id: string): Promise<TestCase> {
  return apiFetch<TestCase>(`/test-cases/${id}/duplicate`, { method: 'POST' })
}

/**
 * Export path for the project's test cases: the list page's current filters and
 * sort (so the file is the filtered set, ADR-117) plus `columns` for the
 * "Selected columns" option (omit it for all 22 fields). Paging is dropped.
 */
export function testCaseExportPath(
  projectId: string,
  format: 'csv' | 'xlsx',
  params: TestCaseListParams = {},
  columns?: string[],
): string {
  const query = new URLSearchParams(testCaseQuery({ ...params, page: undefined, page_size: undefined }))
  if (columns && columns.length > 0) query.set('columns', columns.join(','))
  const qs = query.toString()
  return `/projects/${projectId}/test-cases/export.${format}${qs ? `?${qs}` : ''}`
}
