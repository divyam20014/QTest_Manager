import { apiFetch } from '@/api/client'
import type { RoleCode } from '@/api/auth'

export interface User {
  id: string
  email: string
  name: string
  role: RoleCode
  is_active: boolean
  created_at: string
}

export interface UserCreateRequest {
  email: string
  name: string
  role: RoleCode
  password: string
}

export interface UserUpdateRequest {
  name?: string
  role?: RoleCode
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
