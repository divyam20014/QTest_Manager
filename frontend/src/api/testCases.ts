import { apiFetch } from '@/api/client'

export type Priority = 'Low' | 'Medium' | 'High' | 'Critical'
export type TestCaseStatus = 'draft' | 'ready_for_review' | 'approved' | 'deprecated'

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
  priority: Priority
  status: TestCaseStatus
  assignee_id: string | null
  version_number: number
  created_by: string
  created_at: string
  steps: StepOut[]
}

export interface TestCaseVersion {
  version_number: number
  title: string
  approved_by: string | null
  approved_at: string | null
  created_by: string
  created_at: string
  steps: StepOut[]
}

export interface TestCaseCreateRequest {
  title: string
  priority: Priority
  assignee_id?: string | null
  steps: StepIn[]
}

export type TestCaseUpdateRequest = Partial<TestCaseCreateRequest>

export function listTestCases(projectId: string): Promise<TestCase[]> {
  return apiFetch<TestCase[]>(`/projects/${projectId}/test-cases`)
}

export function getTestCase(id: string): Promise<TestCase> {
  return apiFetch<TestCase>(`/test-cases/${id}`)
}

export function listTestCaseVersions(id: string): Promise<TestCaseVersion[]> {
  return apiFetch<TestCaseVersion[]>(`/test-cases/${id}/versions`)
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

export function submitForReview(id: string): Promise<TestCase> {
  return apiFetch<TestCase>(`/test-cases/${id}/submit-review`, { method: 'POST' })
}

export function approveTestCase(id: string): Promise<TestCase> {
  return apiFetch<TestCase>(`/test-cases/${id}/approve`, { method: 'POST' })
}

export function deleteTestCase(id: string): Promise<{ deleted: boolean }> {
  return apiFetch<{ deleted: boolean }>(`/test-cases/${id}`, { method: 'DELETE' })
}
