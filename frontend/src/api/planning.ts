// Phase 2: planning a project's work. Mirrors app/schemas/planning.py.
import { apiFetch } from '@/api/client'
import type { Task, TaskStatusRef } from '@/api/tasks'

export const MAX_BACKLOG_PAGE = 500

export interface Backlog {
  items: Task[]
  total: number
}

export const getBacklog = (projectId: string, limit: number): Promise<Backlog> =>
  apiFetch<Backlog>(`/projects/${projectId}/backlog?limit=${limit}`)

/** Places the task immediately before `beforeTaskId`; null puts it at the end. */
export const moveInBacklog = (taskId: string, beforeTaskId: string | null): Promise<Task> =>
  apiFetch<Task>(`/tasks/${taskId}/rank`, { method: 'POST', body: JSON.stringify({ before_task_id: beforeTaskId }) })

// --- milestones (ADR-145) -------------------------------------------------------------------

export interface Milestone {
  id: string
  project_id: string
  name: string
  description: string | null
  due_date: string | null
  completed_at: string | null
  task_count: number
  done_count: number
  estimate_hours: string
  done_estimate_hours: string
}

export interface MilestoneCreate {
  name: string
  description?: string | null
  due_date?: string | null
}

export type MilestoneUpdate = Partial<MilestoneCreate> & { completed?: boolean }

export const listMilestones = (projectId: string): Promise<Milestone[]> =>
  apiFetch<Milestone[]>(`/projects/${projectId}/milestones`)

export const createMilestone = (projectId: string, req: MilestoneCreate): Promise<Milestone> =>
  apiFetch<Milestone>(`/projects/${projectId}/milestones`, { method: 'POST', body: JSON.stringify(req) })

export const updateMilestone = (id: string, req: MilestoneUpdate): Promise<Milestone> =>
  apiFetch<Milestone>(`/milestones/${id}`, { method: 'PATCH', body: JSON.stringify(req) })

export const deleteMilestone = (id: string): Promise<{ deleted: boolean }> =>
  apiFetch<{ deleted: boolean }>(`/milestones/${id}`, { method: 'DELETE' })

// --- sprints (ADR-146) ------------------------------------------------------------------------

export type SprintState = 'planned' | 'active' | 'closed'

export interface Sprint {
  id: string
  project_id: string
  name: string
  goal: string | null
  start_date: string
  end_date: string
  state: SprintState
  started_at: string | null
  closed_at: string | null
  task_count: number
  done_count: number
  estimate_hours: string
  done_estimate_hours: string
}

export interface SprintTask {
  task_id: string
  display_id: string | null
  title: string
  status: TaskStatusRef
  assignee_name: string | null
  deleted: boolean
  added_after_start: boolean
  removed_at: string | null
  done: boolean
  estimate_hours: string | null
}

export interface SprintTotal {
  count: number
  hours: string
}

export interface SprintDetail extends Sprint {
  totals: Record<'planned' | 'added' | 'removed' | 'completed' | 'unfinished', SprintTotal>
  tasks: SprintTask[]
}

export interface SprintRequest {
  name: string
  goal?: string | null
  start_date: string
  end_date: string
}

export const listSprints = (projectId: string): Promise<Sprint[]> => apiFetch<Sprint[]>(`/projects/${projectId}/sprints`)

export const getSprint = (id: string): Promise<SprintDetail> => apiFetch<SprintDetail>(`/sprints/${id}`)

export const createSprint = (projectId: string, req: SprintRequest): Promise<Sprint> =>
  apiFetch<Sprint>(`/projects/${projectId}/sprints`, { method: 'POST', body: JSON.stringify(req) })

export const updateSprint = (id: string, req: Partial<SprintRequest>): Promise<Sprint> =>
  apiFetch<Sprint>(`/sprints/${id}`, { method: 'PATCH', body: JSON.stringify(req) })

export const deleteSprint = (id: string): Promise<{ deleted: boolean }> =>
  apiFetch<{ deleted: boolean }>(`/sprints/${id}`, { method: 'DELETE' })

export const startSprint = (id: string): Promise<SprintDetail> =>
  apiFetch<SprintDetail>(`/sprints/${id}/start`, { method: 'POST' })

/** `moveUnfinishedTo` is a planned sprint, or null for the backlog. */
export const closeSprint = (id: string, moveUnfinishedTo: string | null): Promise<SprintDetail> =>
  apiFetch<SprintDetail>(`/sprints/${id}/close`, { method: 'POST', body: JSON.stringify({ move_unfinished_to: moveUnfinishedTo }) })

/** Puts the task in a sprint, or takes it out with null. */
export const setTaskSprint = (taskId: string, sprintId: string | null): Promise<Task> =>
  apiFetch<Task>(`/tasks/${taskId}/sprint`, { method: 'PUT', body: JSON.stringify({ sprint_id: sprintId }) })
