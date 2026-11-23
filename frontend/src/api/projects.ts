import { apiFetch } from '@/api/client'

export type Domain = 'Motor' | 'Health' | 'Travel' | 'Life' | 'Property'

// BRD gap Phase 4 / ADR-073 (FR-AUTH-04): an organisation's optional primary
// insurance domain -- the five project domains plus "Other" (another or
// several). It only pre-selects a new project's Domain; it never restricts it.
export const TENANT_DOMAINS = ['Motor', 'Health', 'Travel', 'Life', 'Property', 'Other'] as const
export type TenantDomain = (typeof TENANT_DOMAINS)[number]

export function tenantDomainLabel(domain: TenantDomain): string {
  return domain === 'Other' ? 'Other / multiple' : domain
}

/** The project Domain a tenant's primary domain maps to, or null for "Other"/unset. */
export function projectDomainFor(primary: string | null | undefined): Domain | null {
  return primary && primary !== 'Other' && (TENANT_DOMAINS as readonly string[]).includes(primary)
    ? (primary as Domain)
    : null
}
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
  version: number
  /** ADR-122: saved project-tab order and hidden tabs; null = the default tabs. */
  nav_config: NavConfig | null
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

export interface NavConfig {
  order: string[]
  hidden: string[]
}

export type ProjectUpdateRequest = Partial<ProjectCreateRequest> & {
  /** Send null to go back to the default tabs. */
  nav_config?: NavConfig | null
  /** Reject the write (409) when the project changed since this version. */
  expected_version?: number
}

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

// RBAC Phase 1: project-scoped role overrides.
export interface ProjectMemberWithRole {
  user_id: string
  name: string
  tenant_role_name: string
  project_role_id: string | null
  project_role_name: string | null
}

export function listProjectMembers(projectId: string): Promise<ProjectMemberWithRole[]> {
  return apiFetch<ProjectMemberWithRole[]>(`/projects/${projectId}/members`)
}

export function setProjectMemberRole(
  projectId: string,
  userId: string,
  roleId: string | null
): Promise<Project> {
  return apiFetch<Project>(`/projects/${projectId}/members/${userId}/role`, {
    method: 'PATCH',
    body: JSON.stringify({ role_id: roleId }),
  })
}
