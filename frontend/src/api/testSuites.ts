import { apiFetch } from '@/api/client'
import type { RunType, TestRun } from '@/api/execution'

export interface TestSuite {
  id: string
  project_id: string
  name: string
  description: string | null
  created_at: string
  test_case_ids: string[]
}

export function listTestSuites(projectId: string): Promise<TestSuite[]> {
  return apiFetch<TestSuite[]>(`/projects/${projectId}/test-suites`)
}

export function createTestSuite(
  projectId: string,
  req: { name: string; description?: string | null; test_case_ids: string[] },
): Promise<TestSuite> {
  return apiFetch<TestSuite>(`/projects/${projectId}/test-suites`, {
    method: 'POST',
    body: JSON.stringify(req),
  })
}

export function setTestSuiteCases(suiteId: string, testCaseIds: string[]): Promise<TestSuite> {
  return apiFetch<TestSuite>(`/test-suites/${suiteId}/cases`, {
    method: 'PUT',
    body: JSON.stringify({ test_case_ids: testCaseIds }),
  })
}

export function deleteTestSuite(suiteId: string): Promise<{ deleted: boolean }> {
  return apiFetch<{ deleted: boolean }>(`/test-suites/${suiteId}`, { method: 'DELETE' })
}

export function createRunFromSuite(
  suiteId: string,
  req: { name: string; run_type: RunType },
): Promise<TestRun> {
  return apiFetch<TestRun>(`/test-suites/${suiteId}/create-run`, {
    method: 'POST',
    body: JSON.stringify(req),
  })
}
