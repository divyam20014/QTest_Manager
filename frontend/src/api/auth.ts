import { apiFetch } from '@/api/client'

export type RoleCode = 'admin' | 'manager' | 'tester'

export interface MeResponse {
  user_id: string
  tenant_id: string
  email: string
  name: string
  // A system role's real code, OR a custom role's display name (ADR-059) --
  // no longer reliably one of RoleCode's three literals once custom roles
  // exist. Prefer `permissions` for access checks; use `role` for display.
  role: string
  permissions: string[]
}

export function hasPermission(user: MeResponse | null, permission: string): boolean {
  return !!user?.permissions.includes(permission)
}

// Pass 1 (ADR-059): a custom role is "admin/manager-equivalent" for UI
// purposes if it holds the same tenant-wide-access permission the backend
// already uses to compute its effective access tier (SessionContext.role_code)
// -- never a hardcoded role-name comparison, so this stays correct for any
// future custom role too.
export function isManagerOrAbove(user: MeResponse | null): boolean {
  if (!user) return false
  return user.role === 'admin' || user.role === 'manager' || hasPermission(user, 'project.view.all')
}

export function isAdmin(user: MeResponse | null): boolean {
  if (!user) return false
  return user.role === 'admin' || hasPermission(user, 'tenant.settings.manage')
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
