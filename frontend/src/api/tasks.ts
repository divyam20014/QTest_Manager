import { apiFetch } from '@/api/client'

// ADR-127: tasks, sub-tasks and tenant task statuses. Mirrors app/schemas/task.py.

export type TaskStatusCategory = 'todo' | 'in_progress' | 'done'

export interface TaskStatusRef {
  id: string
  code: string
  label: string
  category: TaskStatusCategory
  color: string | null
}

export interface TaskStatus extends TaskStatusRef {
  sort_order: number
  is_default: boolean
  /** Tasks using this status, soft-deleted ones included. */
  task_count: number
}

export interface Task {
  id: string
  project_id: string
  parent_task_id: string | null
  depth: number
  display_id: string | null
  title: string
  description: string | null
  status: TaskStatusRef
  priority: string
  assignee_id: string | null
  assignee_name: string | null
  release_id: string | null
  start_date: string | null
  due_date: string | null
  completed_at: string | null
  is_overdue: boolean
  created_by: string
  created_at: string
  updated_at: string
  /** The project's "Unassigned requirements" task: cannot be deleted, moved or given sub-tasks. */
  is_requirements_home: boolean
  sub_task_count: number
  sub_tasks_done: number
  requirement_count: number
  defect_count: number
  test_case_count: number
}

export interface TaskRef {
  id: string
  display_id: string | null
  title: string
  depth: number
}

export interface TaskLinkedTestCase {
  test_case_id: string
  display_id: string | null
  title: string
  status: string
  linked_by: string
  linked_at: string
}

export interface TaskDetail extends Task {
  ancestors: TaskRef[]
  sub_tasks: Task[]
  test_cases: TaskLinkedTestCase[]
}

export interface TaskListResponse {
  items: Task[]
  total: number
}

export interface TaskCreateRequest {
  title: string
  description?: string | null
  parent_task_id?: string | null
  status_id?: string | null
  priority?: string | null
  assignee_id?: string | null
  release_id?: string | null
  start_date?: string | null
  due_date?: string | null
}

/** Only the fields sent change; `parent_task_id: null` makes the task a root task. */
export type TaskUpdateRequest = Partial<Omit<TaskCreateRequest, 'status_id'>>

export interface TaskListParams {
  page?: number
  page_size?: number
  status_id?: string
  category?: TaskStatusCategory
  assignee_id?: string
  parent_task_id?: string
  root_only?: boolean
  release_id?: string
  overdue?: boolean
  q?: string
}

export interface TaskStatusCreateRequest {
  code: string
  label: string
  category: TaskStatusCategory
  color?: string | null
  sort_order?: number
  is_default?: boolean
}

export type TaskStatusUpdateRequest = Partial<Omit<TaskStatusCreateRequest, 'code'>>

// --- statuses ---------------------------------------------------------------------------

export function listTaskStatuses(): Promise<TaskStatus[]> {
  return apiFetch<TaskStatus[]>('/task-statuses')
}

export function createTaskStatus(req: TaskStatusCreateRequest): Promise<TaskStatus> {
  return apiFetch<TaskStatus>('/task-statuses', { method: 'POST', body: JSON.stringify(req) })
}

export function updateTaskStatus(id: string, req: TaskStatusUpdateRequest): Promise<TaskStatus> {
  return apiFetch<TaskStatus>(`/task-statuses/${id}`, { method: 'PATCH', body: JSON.stringify(req) })
}

export function deleteTaskStatus(id: string): Promise<{ deleted: boolean }> {
  return apiFetch<{ deleted: boolean }>(`/task-statuses/${id}`, { method: 'DELETE' })
}

// --- tasks ------------------------------------------------------------------------------

export function listTasks(projectId: string, params: TaskListParams = {}): Promise<TaskListResponse> {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === '' || value === false) continue
    query.set(key, String(value))
  }
  const qs = query.toString()
  return apiFetch<TaskListResponse>(`/projects/${projectId}/tasks${qs ? `?${qs}` : ''}`)
}

/** Every task of the project, parents before children (for the hierarchy view and pickers). */
export function getProjectTaskTree(projectId: string): Promise<TaskListResponse> {
  return apiFetch<TaskListResponse>(`/projects/${projectId}/tasks/tree`)
}

export function getTask(id: string): Promise<TaskDetail> {
  return apiFetch<TaskDetail>(`/tasks/${id}`)
}

export function createTask(projectId: string, req: TaskCreateRequest): Promise<Task> {
  return apiFetch<Task>(`/projects/${projectId}/tasks`, { method: 'POST', body: JSON.stringify(req) })
}

export function updateTask(id: string, req: TaskUpdateRequest): Promise<Task> {
  return apiFetch<Task>(`/tasks/${id}`, { method: 'PATCH', body: JSON.stringify(req) })
}

export function changeTaskStatus(id: string, statusId: string): Promise<Task> {
  return apiFetch<Task>(`/tasks/${id}/status`, {
    method: 'POST',
    body: JSON.stringify({ status_id: statusId }),
  })
}

/** `cascade` also deletes every sub-task; without it a task that has sub-tasks is refused (409). */
export function deleteTask(id: string, cascade = false): Promise<{ deleted: number }> {
  return apiFetch<{ deleted: number }>(`/tasks/${id}${cascade ? '?cascade=true' : ''}`, { method: 'DELETE' })
}

export function linkTaskTestCase(id: string, testCaseId: string): Promise<TaskDetail> {
  return apiFetch<TaskDetail>(`/tasks/${id}/test-cases`, {
    method: 'POST',
    body: JSON.stringify({ test_case_id: testCaseId }),
  })
}

export function unlinkTaskTestCase(id: string, testCaseId: string): Promise<TaskDetail> {
  return apiFetch<TaskDetail>(`/tasks/${id}/test-cases/${testCaseId}`, { method: 'DELETE' })
}

// --- roll-ups, effective test cases, runs and history (phase 4) -------------------------------

export interface TaskRollup {
  task_id: string
  include_sub_tasks: boolean
  sub_tasks_total: number
  sub_tasks_todo: number
  sub_tasks_in_progress: number
  sub_tasks_done: number
  sub_tasks_overdue: number
  /** 0-100: share of sub-tasks done (a task without sub-tasks is 0 or 100 by its own status). */
  progress_percent: number
  requirements_total: number
  requirements_covered: number
  test_cases_total: number
  test_cases_passed: number
  test_cases_failed: number
  test_cases_blocked: number
  test_cases_not_run: number
  /** passed / executed over each case's latest result; null before any result. */
  pass_rate: number | null
  test_runs_total: number
  defects_total: number
  defects_open: number
  defects_critical_open: number
}

export interface TaskTestCaseRow {
  test_case_id: string
  display_id: string | null
  title: string
  status: string
  linked_directly: boolean
  via_requirement: boolean
  last_result: 'passed' | 'failed' | 'blocked' | null
  task_id: string
  task_display_id: string | null
}

export interface TaskRunRow {
  run_id: string
  name: string
  run_type: string
  created_at: string
  finished_at: string | null
  cases_total: number
  cases_passed: number
  cases_failed: number
  cases_blocked: number
}

const withSubTasks = (include: boolean) => `?include_sub_tasks=${include ? 'true' : 'false'}`

export function getTaskRollup(id: string, includeSubTasks = true): Promise<TaskRollup> {
  return apiFetch<TaskRollup>(`/tasks/${id}/rollup${withSubTasks(includeSubTasks)}`)
}

export function listTaskTestCases(id: string, includeSubTasks = true): Promise<TaskTestCaseRow[]> {
  return apiFetch<TaskTestCaseRow[]>(`/tasks/${id}/test-cases${withSubTasks(includeSubTasks)}`)
}

export function listTaskRuns(id: string, includeSubTasks = true): Promise<TaskRunRow[]> {
  return apiFetch<TaskRunRow[]>(`/tasks/${id}/test-runs${withSubTasks(includeSubTasks)}`)
}

export function getTaskHistory(id: string): Promise<import('@/api/history').HistoryEntry[]> {
  return apiFetch<import('@/api/history').HistoryEntry[]>(`/tasks/${id}/history`)
}

// --- project summary (the Overview "Task progress" widget) --------------------------------------

export interface TaskSummaryStatus {
  status_id: string
  code: string
  label: string
  category: TaskStatusCategory
  color: string | null
  count: number
}

export interface TaskSummary {
  project_id: string
  total: number
  top_level: number
  sub_tasks: number
  todo: number
  in_progress: number
  done: number
  /** 0-100: share of all the project's tasks that are done. */
  progress_percent: number
  overdue: number
  due_next_7_days: number
  unassigned_open: number
  completed_last_7_days: number
  by_status: TaskSummaryStatus[]
}

export function getProjectTaskSummary(projectId: string): Promise<TaskSummary> {
  return apiFetch<TaskSummary>(`/projects/${projectId}/tasks/summary`)
}
