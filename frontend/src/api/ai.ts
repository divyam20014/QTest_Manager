import { apiFetch } from '@/api/client'
import type { TestCase } from '@/api/testCases'

export interface GenerateTestCasesResponse {
  items: TestCase[]
  prompt_tokens: number
  completion_tokens: number
  total_tokens: number
}

export interface AIUsageSummary {
  total_requests: number
  successful_requests: number
  total_prompt_tokens: number
  total_completion_tokens: number
  total_tokens: number
}

export type ReviewSuggestionCategory = 'clarity' | 'missing_steps' | 'ambiguous_expected' | 'other'

export interface ReviewSuggestion {
  category: ReviewSuggestionCategory | string
  message: string
}

export interface ReviewTestCaseResponse {
  suggestions: ReviewSuggestion[]
  prompt_tokens: number
  completion_tokens: number
  total_tokens: number
}

export interface ChangeImpactFinding {
  test_case_id: string
  test_case_title: string
  needs_review: boolean
  reason: string
}

export interface AnalyzeRequirementChangeResponse {
  old_version_number: number
  new_version_number: number
  findings: ChangeImpactFinding[]
  prompt_tokens: number
  completion_tokens: number
  total_tokens: number
}

export function generateTestCases(
  requirementId: string,
  maxCases: number = 3,
): Promise<GenerateTestCasesResponse> {
  return apiFetch<GenerateTestCasesResponse>(`/requirements/${requirementId}/generate-test-cases`, {
    method: 'POST',
    body: JSON.stringify({ max_cases: maxCases }),
  })
}

export function reviewTestCase(testCaseId: string): Promise<ReviewTestCaseResponse> {
  return apiFetch<ReviewTestCaseResponse>(`/test-cases/${testCaseId}/ai-review`, {
    method: 'POST',
  })
}

export function analyzeRequirementChange(
  requirementId: string,
): Promise<AnalyzeRequirementChangeResponse> {
  return apiFetch<AnalyzeRequirementChangeResponse>(
    `/requirements/${requirementId}/analyze-change`,
    { method: 'POST' },
  )
}

export function getAIUsageSummary(): Promise<AIUsageSummary> {
  return apiFetch<AIUsageSummary>('/ai/usage')
}
