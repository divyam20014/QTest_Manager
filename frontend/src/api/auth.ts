import { apiFetch } from '@/api/client'

export type RoleCode = 'admin' | 'manager' | 'tester'

export interface MeResponse {
  user_id: string
  tenant_id: string
  email: string
  name: string
  role: RoleCode
}

export interface LoginRequest {
  tenant_id: string
  email: string
  password: string
}

export interface LoginResponse {
  mfa_required: boolean
  debug_code?: string
}

export function login(req: LoginRequest): Promise<LoginResponse> {
  return apiFetch<LoginResponse>('/auth/login', { method: 'POST', body: JSON.stringify(req) })
}

export function verifyMfa(code: string): Promise<{ verified: boolean }> {
  return apiFetch<{ verified: boolean }>('/auth/mfa/verify', {
    method: 'POST',
    body: JSON.stringify({ code }),
  })
}

export function logout(): Promise<{ logged_out: boolean }> {
  return apiFetch<{ logged_out: boolean }>('/auth/logout', { method: 'POST' })
}

export function fetchMe(): Promise<MeResponse> {
  return apiFetch<MeResponse>('/auth/me')
}
