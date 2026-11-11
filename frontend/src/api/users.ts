import { apiFetch } from '@/api/client'
import type { RoleCode } from '@/api/auth'

export interface User {
  id: string
  email: string
  name: string
  role: string
  role_id: string
  is_active: boolean
  created_at: string
}

export interface UserCreateRequest {
  email: string
  name: string
  // ADR-059: pass exactly one -- `role` for a fixed system role (back-
  // compat), `role_id` to assign any of the tenant's own custom roles.
  role?: RoleCode
  role_id?: string
  password: string
}

export interface UserUpdateRequest {
  name?: string
  role?: RoleCode
  role_id?: string
  is_active?: boolean
}

export function listUsers(): Promise<User[]> {
  return apiFetch<User[]>('/users')
}

export function createUser(req: UserCreateRequest): Promise<User> {
  return apiFetch<User>('/users', { method: 'POST', body: JSON.stringify(req) })
}

export function updateUser(userId: string, req: UserUpdateRequest): Promise<User> {
  return apiFetch<User>(`/users/${userId}`, { method: 'PATCH', body: JSON.stringify(req) })
}

export function deactivateUser(userId: string): Promise<User> {
  return apiFetch<User>(`/users/${userId}`, { method: 'DELETE' })
}

export function resetPassword(userId: string, newPassword: string): Promise<User> {
  return apiFetch<User>(`/users/${userId}/reset-password`, {
    method: 'POST',
    body: JSON.stringify({ new_password: newPassword }),
  })
}

// Tier 1 / ADR-053: replaces admin-sets-the-password-directly provisioning
// (createUser above still exists for back-compat/scripts) with an invite
// the invitee accepts themself.
export interface UserInviteRequest {
  email: string
  name: string
  role: RoleCode
}

export interface UserInviteOut {
  id: string
  email: string
  expires_at: string
  // Only non-null in "simulated" email-delivery mode -- dev/test convenience.
  invite_token: string | null
}

export function inviteUser(req: UserInviteRequest): Promise<UserInviteOut> {
  return apiFetch<UserInviteOut>('/users/invite', { method: 'POST', body: JSON.stringify(req) })
}

export function acceptInvite(token: string, password: string): Promise<User> {
  return apiFetch<User>(`/users/invite/${encodeURIComponent(token)}/accept`, {
    method: 'POST',
    body: JSON.stringify({ password }),
  })
}
