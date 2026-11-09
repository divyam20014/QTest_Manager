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

export interface TestRunCreateRequest {
  name: string
  run_type: RunType
  test_case_ids: string[]
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

export function finishTestRun(runId: string): Promise<TestRun> {
  return apiFetch<TestRun>(`/test-runs/${runId}/finish`, { method: 'POST' })
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
