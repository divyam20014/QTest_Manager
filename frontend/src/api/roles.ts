import { apiFetch } from '@/api/client'

export interface Permission {
  code: string
  description: string | null
}

export interface Role {
  id: string
  name: string
  code: string | null
  is_system: boolean
  is_active: boolean
  permission_codes: string[]
  user_count: number
}

export interface RoleCreateRequest {
  name: string
  permission_codes: string[]
}

export interface RoleUpdateRequest {
  name?: string
  permission_codes?: string[]
}

export function listRoles(): Promise<Role[]> {
  return apiFetch<Role[]>('/roles')
}

export function listPermissions(): Promise<Permission[]> {
  return apiFetch<Permission[]>('/roles/permissions')
}

export function createRole(req: RoleCreateRequest): Promise<Role> {
  return apiFetch<Role>('/roles', { method: 'POST', body: JSON.stringify(req) })
}

export function updateRole(roleId: string, req: RoleUpdateRequest): Promise<Role> {
  return apiFetch<Role>(`/roles/${roleId}`, { method: 'PATCH', body: JSON.stringify(req) })
}

export function deactivateRole(roleId: string): Promise<Role> {
  return apiFetch<Role>(`/roles/${roleId}`, { method: 'DELETE' })
}
