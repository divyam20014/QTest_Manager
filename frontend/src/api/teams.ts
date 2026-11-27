// ADR-141: teams. A team gives no access by itself; adding it to a project adds its members then.
import { apiFetch } from '@/api/client'

export interface TeamMember {
  user_id: string
  name: string
  is_active: boolean
}

export interface Team {
  id: string
  name: string
  lead_user_id: string | null
  lead_name: string | null
  members: TeamMember[]
}

export interface TeamRequest {
  name: string
  lead_user_id: string | null
  member_ids: string[]
}

export interface TeamAddResult {
  added: number
  already_members: number
  skipped_inactive: number
}

export const listTeams = (): Promise<Team[]> => apiFetch<Team[]>('/teams')

export const createTeam = (req: TeamRequest): Promise<Team> =>
  apiFetch<Team>('/teams', { method: 'POST', body: JSON.stringify(req) })

export const updateTeam = (id: string, req: TeamRequest): Promise<Team> =>
  apiFetch<Team>(`/teams/${id}`, { method: 'PATCH', body: JSON.stringify(req) })

export const deleteTeam = (id: string): Promise<{ deleted: boolean }> =>
  apiFetch<{ deleted: boolean }>(`/teams/${id}`, { method: 'DELETE' })

export const addTeamToProject = (projectId: string, teamId: string): Promise<TeamAddResult> =>
  apiFetch<TeamAddResult>(`/projects/${projectId}/teams/${teamId}`, { method: 'POST' })

/** What happened, in words, for the message after adding a team. */
export function describeTeamAdd(r: TeamAddResult): string {
  const parts = [`${r.added} member${r.added === 1 ? '' : 's'} added`]
  if (r.already_members) parts.push(`${r.already_members} already on the project`)
  if (r.skipped_inactive) parts.push(`${r.skipped_inactive} inactive skipped`)
  return parts.join(', ')
}
