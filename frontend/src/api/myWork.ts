import { apiFetch } from '@/api/client'

// ADR-121: read-only lists of the signed-in user's own pending work. Defects reuse the
// existing /defects filters (assignee_id / reported_by), so only run cases and reviews
// have endpoints of their own.

export type MyRunCaseStatus = 'pending' | 'in_progress' | 'failed' | 'blocked'

export interface MyRunCase {
  id: string
  run_id: string
  run_name: string
  run_paused: boolean
  project_id: string
  project_name: string
  test_case_id: string
  test_case_display_id: string | null
  title: string
  status: MyRunCaseStatus
  blocked_reason: string | null
  started_at: string | null
}

export interface MyReview {
  id: string
  display_id: string | null
  title: string
  priority: string
  project_id: string
  project_name: string
  created_at: string
}

export interface MyWorkSummary {
  run_cases_pending: number
  run_cases_in_progress: number
  run_cases_failed: number
  run_cases_blocked: number
  run_cases_total: number
  reviews_total: number
}

export function getMyWorkSummary(): Promise<MyWorkSummary> {
  return apiFetch<MyWorkSummary>('/my-work/summary')
}

export function listMyRunCases(): Promise<{ items: MyRunCase[]; total: number }> {
  return apiFetch('/my-work/run-cases')
}

export function listMyReviews(): Promise<{ items: MyReview[]; total: number }> {
  return apiFetch('/my-work/reviews')
}
