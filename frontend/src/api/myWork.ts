import { apiFetch } from '@/api/client'
import type { TaskStatusRef } from '@/api/tasks'

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
  /** ADR-123: assignment due date (YYYY-MM-DD); `overdue` = past due and not yet executed. */
  due_date: string | null
  overdue: boolean
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

export interface MyTask {
  id: string
  display_id: string | null
  title: string
  project_id: string
  project_name: string
  status: TaskStatusRef
  priority: string
  due_date: string | null
  /** Past due and not in a "done" status. */
  overdue: boolean
}

export interface MyWorkSummary {
  run_cases_pending: number
  run_cases_in_progress: number
  run_cases_failed: number
  run_cases_blocked: number
  run_cases_total: number
  reviews_total: number
  tasks_total: number
  tasks_overdue: number
}

export function getMyWorkSummary(): Promise<MyWorkSummary> {
  return apiFetch<MyWorkSummary>('/my-work/summary')
}

export function listMyRunCases(projectId?: string): Promise<{ items: MyRunCase[]; total: number }> {
  return apiFetch(`/my-work/run-cases${projectId ? `?project_id=${projectId}` : ''}`)
}

export function listMyTasks(): Promise<{ items: MyTask[]; total: number }> {
  return apiFetch('/my-work/tasks')
}

export function listMyReviews(): Promise<{ items: MyReview[]; total: number }> {
  return apiFetch('/my-work/reviews')
}
