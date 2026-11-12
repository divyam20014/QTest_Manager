import { apiFetch } from '@/api/client'

export interface TestPlan {
  id: string
  project_id: string
  release_id: string | null
  name: string
  description: string | null
  created_at: string
  test_run_ids: string[]
}

export interface TestPlanRollup {
  test_plan_id: string
  total_test_cases: number
  execution_completion_percentage: number
  pass_percentage: number
  open_defects_by_severity: Record<string, number>
}

export function listTestPlans(projectId: string): Promise<TestPlan[]> {
  return apiFetch<TestPlan[]>(`/projects/${projectId}/test-plans`)
}

export function createTestPlan(
  projectId: string,
  req: { name: string; description?: string | null; release_id?: string | null; test_run_ids: string[] },
): Promise<TestPlan> {
  return apiFetch<TestPlan>(`/projects/${projectId}/test-plans`, {
    method: 'POST',
    body: JSON.stringify(req),
  })
}

export function setTestPlanRuns(planId: string, testRunIds: string[]): Promise<TestPlan> {
  return apiFetch<TestPlan>(`/test-plans/${planId}/runs`, {
    method: 'PUT',
    body: JSON.stringify({ test_run_ids: testRunIds }),
  })
}

export function deleteTestPlan(planId: string): Promise<{ deleted: boolean }> {
  return apiFetch<{ deleted: boolean }>(`/test-plans/${planId}`, { method: 'DELETE' })
}

export function getTestPlanRollup(planId: string): Promise<TestPlanRollup> {
  return apiFetch<TestPlanRollup>(`/test-plans/${planId}/rollup`)
}
