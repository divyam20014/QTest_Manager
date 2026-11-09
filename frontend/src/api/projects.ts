import { apiFetch } from '@/api/client'

export type Domain = 'Motor' | 'Health' | 'Travel' | 'Life' | 'Property'
export type Priority = 'Low' | 'Medium' | 'High' | 'Critical'
export type ProjectStatus = 'On Track' | 'At Risk' | 'Delayed' | 'Completed'

export interface Project {
  id: string
  name: string
  domain: Domain
  status: ProjectStatus
  priority: Priority
  manager_name: string
  manager_user_id: string | null
  start_date: string
  end_date: string
  budget: string
  currency_code: string
  region: string
  owner_id: string
  assigned_user_ids: string[]
  created_at: string
  test_case_count: number
  approved_test_case_count: number
  test_run_count: number
  open_defect_count: number
}

export interface ProjectListResponse {
  items: Project[]
  total: number
}

export interface ProjectListParams {
  search?: string
  domain?: Domain | ''
  status?: ProjectStatus | ''
  priority?: Priority | ''
  sort?: string
  page?: number
  page_size?: number
}

export interface ProjectCreateRequest {
  name: string
  domain: Domain
  priority: Priority
  status?: ProjectStatus
  manager_name: string
  manager_user_id?: string | null
  start_date: string
  end_date: string
  budget: string
  currency_code?: string
  region: string
}

export type ProjectUpdateRequest = Partial<ProjectCreateRequest>

export function listProjects(params: ProjectListParams = {}): Promise<ProjectListResponse> {
  const query = new URLSearchParams()
  if (params.search) query.set('search', params.search)
  if (params.domain) query.set('domain', params.domain)
  if (params.status) query.set('status', params.status)
  if (params.priority) query.set('priority', params.priority)
  if (params.sort) query.set('sort', params.sort)
  if (params.page) query.set('page', String(params.page))
  if (params.page_size) query.set('page_size', String(params.page_size))
  const qs = query.toString()
  return apiFetch<ProjectListResponse>(`/projects${qs ? `?${qs}` : ''}`)
}

export function getProject(id: string): Promise<Project> {
  return apiFetch<Project>(`/projects/${id}`)
}

export function createProject(req: ProjectCreateRequest): Promise<Project> {
  return apiFetch<Project>('/projects', { method: 'POST', body: JSON.stringify(req) })
}

export function updateProject(id: string, req: ProjectUpdateRequest): Promise<Project> {
  return apiFetch<Project>(`/projects/${id}`, { method: 'PATCH', body: JSON.stringify(req) })
}

export function deleteProject(id: string): Promise<{ deleted: boolean }> {
  return apiFetch<{ deleted: boolean }>(`/projects/${id}`, { method: 'DELETE' })
}

export function addProjectMember(projectId: string, userId: string): Promise<Project> {
  return apiFetch<Project>(`/projects/${projectId}/members`, {
    method: 'POST',
    body: JSON.stringify({ user_id: userId }),
  })
}

export function removeProjectMember(projectId: string, userId: string): Promise<Project> {
  return apiFetch<Project>(`/projects/${projectId}/members/${userId}`, { method: 'DELETE' })
}
