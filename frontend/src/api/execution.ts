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
  assigned_to: string | null
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
  status: RunCaseStatus
  data_row_id: string | null
  data_row_name: string | null
  data_row_values: Record<string, unknown> | null
}

export interface TestRunCreateRequest {
  name: string
  run_type: RunType
  test_case_ids: string[]
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

export function assignRunCase(
  testRunCaseId: string,
  assignedTo: string | null,
): Promise<{ id: string; assigned_to: string | null }> {
  return apiFetch(`/test-run-cases/${testRunCaseId}/assign`, {
    method: 'PATCH',
    body: JSON.stringify({ assigned_to: assignedTo }),
  })
}

export function pauseTestRun(runId: string): Promise<TestRun> {
  return apiFetch<TestRun>(`/test-runs/${runId}/pause`, { method: 'POST' })
}

export function resumeTestRun(runId: string): Promise<TestRun> {
  return apiFetch<TestRun>(`/test-runs/${runId}/resume`, { method: 'POST' })
}

export function finishTestRun(runId: string): Promise<TestRun> {
  return apiFetch<TestRun>(`/test-runs/${runId}/finish`, { method: 'POST' })
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

export function recordVerdict(stepId: string, verdict: Verdict): Promise<ExecutionStep> {
  return apiFetch<ExecutionStep>(`/execution-steps/${stepId}/verdict`, {
    method: 'POST',
    body: JSON.stringify({ verdict }),
  })
}
