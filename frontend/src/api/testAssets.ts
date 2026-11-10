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
}

export interface BuildCreateRequest {
  name: string
  built_at?: string | null
  notes?: string | null
}

export interface Release {
  id: string
  project_id: string
  name: string
  release_date: string | null
  notes: string | null
  created_at: string
}

export interface ReleaseCreateRequest {
  name: string
  release_date?: string | null
  notes?: string | null
}

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

export function listReleases(projectId: string): Promise<Release[]> {
  return apiFetch<Release[]>(`/projects/${projectId}/releases`)
}

export function createRelease(projectId: string, req: ReleaseCreateRequest): Promise<Release> {
  return apiFetch<Release>(`/projects/${projectId}/releases`, {
    method: 'POST',
    body: JSON.stringify(req),
  })
}

export function deleteRelease(id: string): Promise<{ deleted: boolean }> {
  return apiFetch<{ deleted: boolean }>(`/releases/${id}`, { method: 'DELETE' })
}
