import { apiFetch } from '@/api/client'

export type RunType = 'Regression' | 'Sanity' | 'Smoke'
export type RunCaseStatus = 'pending' | 'in_progress' | 'passed' | 'failed' | 'blocked' | 'ignored'
export type Verdict = 'pass' | 'fail' | 'ignore'

export interface TestRunSummary {
  id: string
  project_id: string
  name: string
  run_type: RunType
  executed_by: string
  created_at: string
  finished_at: string | null
  paused_at: string | null
  case_count: number
}

export interface TestRunCase {
  id: string
  test_case_id: string
  test_case_version_id: string
  title: string
  status: RunCaseStatus
  blocked_reason: string | null
  assigned_to: string | null
  /** ADR-123: assignment due date (YYYY-MM-DD) or null. */
  due_date?: string | null
  started_at: string | null
  completed_at: string | null
  step_count: number
  passed_count: number
  failed_count: number
  ignored_count: number
}

export interface TestRun {
  id: string
  project_id: string
  name: string
  run_type: RunType
  executed_by: string
  created_at: string
  finished_at: string | null
  paused_at: string | null
  original_run_id?: string | null
  cases: TestRunCase[]
}

export interface ExecutionStep {
  id: string
  test_case_version_step_id: string
  step_number: number
  action: string
  expected: string
  verdict: Verdict | null
  opened_at: string | null
  closed_at: string | null
  duration_ms: number | null
  executed_by: string | null
}

export interface RunCaseContext {
  run_id: string
  run_name: string
  run_finished: boolean
  run_paused: boolean
  project_id: string
  project_name: string
  test_case_id: string
  test_case_title: string
  priority: string
  version_number: number
  assignee_id: string | null
  assignee_name: string | null
  due_date?: string | null
  status: RunCaseStatus
  blocked_reason: string | null
  data_row_id: string | null
  data_row_name: string | null
  data_row_values: Record<string, unknown> | null
}

export interface TestRunCreateRequest {
  name: string
  run_type: RunType
  test_case_ids: string[]
  /** ADR-097: skip cases flagged as quarantined (default false). */
  exclude_quarantined?: boolean
  /** ADR-123: due date (YYYY-MM-DD) applied to every case bundled. */
  due_date?: string | null
}

export interface TestRunUpdateRequest {
  name?: string
  run_type?: RunType
}

export function listTestRuns(projectId: string): Promise<TestRunSummary[]> {
  return apiFetch<TestRunSummary[]>(`/projects/${projectId}/test-runs`)
}

export function createTestRun(projectId: string, req: TestRunCreateRequest): Promise<TestRun> {
  return apiFetch<TestRun>(`/projects/${projectId}/test-runs`, { method: 'POST', body: JSON.stringify(req) })
}

export function getTestRun(runId: string): Promise<TestRun> {
  return apiFetch<TestRun>(`/test-runs/${runId}`)
}

export function updateTestRun(runId: string, req: TestRunUpdateRequest): Promise<TestRun> {
  return apiFetch<TestRun>(`/test-runs/${runId}`, { method: 'PATCH', body: JSON.stringify(req) })
}

export function addTestRunCases(
  runId: string,
  testCaseIds: string[],
  dataRowIds?: Record<string, string[]>,
): Promise<TestRun> {
  return apiFetch<TestRun>(`/test-runs/${runId}/cases`, {
    method: 'POST',
    body: JSON.stringify({
      test_case_ids: testCaseIds,
      data_row_ids: dataRowIds ?? {},
    }),
  })
}

export function removeTestRunCase(runId: string, testRunCaseId: string): Promise<TestRun> {
  return apiFetch<TestRun>(`/test-runs/${runId}/cases/${testRunCaseId}`, { method: 'DELETE' })
}

/** ADR-123: assignee and due date are independent. Pass `undefined` to leave one alone, `null` to clear it. */
export function assignRunCase(
  testRunCaseId: string,
  assignedTo: string | null | undefined,
  dueDate?: string | null,
): Promise<{ id: string; assigned_to: string | null; due_date: string | null }> {
  const body: Record<string, string | null> = {}
  if (assignedTo !== undefined) body.assigned_to = assignedTo
  if (dueDate !== undefined) body.due_date = dueDate
  return apiFetch(`/test-run-cases/${testRunCaseId}/assign`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  })
}

export function pauseTestRun(runId: string): Promise<TestRun> {
  return apiFetch<TestRun>(`/test-runs/${runId}/pause`, { method: 'POST' })
}

export function resumeTestRun(runId: string): Promise<TestRun> {
  return apiFetch<TestRun>(`/test-runs/${runId}/resume`, { method: 'POST' })
}

// ADR-078: one page of runs across every project the caller may see, newest first,
// plus how many match in all.
export interface TestRunPage {
  items: TestRunSummary[]
  total: number
}

export function listAllTestRuns(params: {
  project_id?: string
  active_only?: boolean
  /** Status tab: not finished and not paused / paused / finished. */
  status?: 'in_progress' | 'paused' | 'finished'
  search?: string
  page?: number
  page_size?: number
}): Promise<TestRunPage> {
  const query = new URLSearchParams()
  if (params.project_id) query.set('project_id', params.project_id)
  if (params.active_only) query.set('active_only', 'true')
  if (params.status) query.set('status', params.status)
  if (params.search) query.set('search', params.search)
  if (params.page) query.set('page', String(params.page))
  if (params.page_size) query.set('page_size', String(params.page_size))
  const qs = query.toString()
  return apiFetch<TestRunPage>(`/test-runs${qs ? `?${qs}` : ''}`)
}

export function finishTestRun(runId: string): Promise<TestRun> {
  return apiFetch<TestRun>(`/test-runs/${runId}/finish`, { method: 'POST' })
}

// ADR-075: undo a finish so a blocked case can be unblocked / work can continue.
export function reopenTestRun(runId: string): Promise<TestRun> {
  return apiFetch<TestRun>(`/test-runs/${runId}/reopen`, { method: 'POST' })
}

// ADR-096: new run containing only this run's failed and blocked cases.
export function rerunFailedTestRun(runId: string): Promise<TestRun> {
  return apiFetch<TestRun>(`/test-runs/${runId}/rerun-failed`, { method: 'POST' })
}

export function getRunCaseContext(runCaseId: string): Promise<RunCaseContext> {
  return apiFetch<RunCaseContext>(`/test-run-cases/${runCaseId}/context`)
}

export function listRunCaseSteps(runCaseId: string): Promise<ExecutionStep[]> {
  return apiFetch<ExecutionStep[]>(`/test-run-cases/${runCaseId}/steps`)
}

export function openStep(stepId: string): Promise<ExecutionStep> {
  return apiFetch<ExecutionStep>(`/execution-steps/${stepId}/open`, { method: 'POST' })
}

/** ADR-116: `actualResult` is what actually happened; the UI requires it for Fail. */
export function recordVerdict(
  stepId: string,
  verdict: Verdict,
  actualResult?: string | null,
): Promise<ExecutionStep> {
  const body: { verdict: Verdict; actual_result?: string } = { verdict }
  if (actualResult && actualResult.trim()) body.actual_result = actualResult.trim()
  return apiFetch<ExecutionStep>(`/execution-steps/${stepId}/verdict`, {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

/** ADR-070: mark a run case Blocked (a reason is required). */
export function blockRunCase(
  runCaseId: string,
  reason: string,
): Promise<{ id: string; status: RunCaseStatus; blocked_reason: string | null }> {
  return apiFetch(`/test-run-cases/${runCaseId}/block`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  })
}

export function unblockRunCase(
  runCaseId: string,
): Promise<{ id: string; status: RunCaseStatus; blocked_reason: string | null }> {
  return apiFetch(`/test-run-cases/${runCaseId}/unblock`, { method: 'POST' })
}

/** ADR-070: soft delete (Admin/Manager). */
export function deleteTestRun(runId: string): Promise<{ id: string; deleted: boolean }> {
  return apiFetch(`/test-runs/${runId}`, { method: 'DELETE' })
}
