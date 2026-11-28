import { apiFetch } from '@/api/client'

export interface Environment {
  id: string
  name: string
  description: string | null
  created_at: string
}

export interface EnvironmentCreateRequest {
  name: string
  description?: string | null
}

export interface Build {
  id: string
  project_id: string
  name: string
  built_at: string | null
  notes: string | null
  created_at: string
  /** ADR-152 */
  release_id?: string | null
}

export interface BuildCreateRequest {
  name: string
  built_at?: string | null
  notes?: string | null
  release_id?: string | null
}

export interface Release {
  id: string
  project_id: string
  name: string
  release_date: string | null
  notes: string | null
  /** ADR-122; null for releases that never had a status set. */
  status: ReleaseStatus | null
  created_at: string
}

export const RELEASE_STATUSES = ['Planned', 'In Progress', 'Released', 'Cancelled'] as const
export type ReleaseStatus = (typeof RELEASE_STATUSES)[number]

export interface ReleaseCreateRequest {
  name: string
  release_date?: string | null
  notes?: string | null
  status?: ReleaseStatus | null
}

export type ReleaseUpdateRequest = Partial<ReleaseCreateRequest>

export function listEnvironments(): Promise<Environment[]> {
  return apiFetch<Environment[]>('/environments')
}

export function createEnvironment(req: EnvironmentCreateRequest): Promise<Environment> {
  return apiFetch<Environment>('/environments', { method: 'POST', body: JSON.stringify(req) })
}

export function deleteEnvironment(id: string): Promise<{ deleted: boolean }> {
  return apiFetch<{ deleted: boolean }>(`/environments/${id}`, { method: 'DELETE' })
}

export function listBuilds(projectId: string): Promise<Build[]> {
  return apiFetch<Build[]>(`/projects/${projectId}/builds`)
}

export function createBuild(projectId: string, req: BuildCreateRequest): Promise<Build> {
  return apiFetch<Build>(`/projects/${projectId}/builds`, {
    method: 'POST',
    body: JSON.stringify(req),
  })
}

export function deleteBuild(id: string): Promise<{ deleted: boolean }> {
  return apiFetch<{ deleted: boolean }>(`/builds/${id}`, { method: 'DELETE' })
}

/** Puts the build in a release, or takes it out with null. */
export function updateBuild(id: string, req: { release_id: string | null }): Promise<Build> {
  return apiFetch<Build>(`/builds/${id}`, { method: 'PATCH', body: JSON.stringify(req) })
}

export function listReleases(projectId: string): Promise<Release[]> {
  return apiFetch<Release[]>(`/projects/${projectId}/releases`)
}

export function createRelease(projectId: string, req: ReleaseCreateRequest): Promise<Release> {
  return apiFetch<Release>(`/projects/${projectId}/releases`, {
    method: 'POST',
    body: JSON.stringify(req),
  })
}

export function updateRelease(id: string, req: ReleaseUpdateRequest): Promise<Release> {
  return apiFetch<Release>(`/releases/${id}`, { method: 'PATCH', body: JSON.stringify(req) })
}

export function deleteRelease(id: string): Promise<{ deleted: boolean }> {
  return apiFetch<{ deleted: boolean }>(`/releases/${id}`, { method: 'DELETE' })
}
