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

// ADR-067: tenant-less login, step 0 -- resolves which tenant(s) an email
// belongs to before the password/tenant_id is known. Always 200 with a
// (possibly empty) `matches` list, never a distinct "not found" error, so
// the UI can't be used to enumerate registered emails.
export interface TenantMatch {
  tenant_id: string
  tenant_name: string
}

export interface IdentifyResponse {
  matches: TenantMatch[]
}

export function identify(email: string): Promise<IdentifyResponse> {
  return apiFetch<IdentifyResponse>('/auth/identify', {
    method: 'POST',
    body: JSON.stringify({ email }),
  })
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

// Pass 2 (ADR-064): self-service signup. The new admin still goes through
// the ordinary login+MFA flow afterward -- this endpoint only creates the
// tenant/admin/sample project, it never issues a session itself.
export interface SignupRequest {
  tenant_name: string
  admin_name: string
  admin_email: string
  admin_password: string
}

export interface SignupResponse {
  tenant: { id: string; name: string }
  admin_user_id: string
}

export function signup(req: SignupRequest): Promise<SignupResponse> {
  return apiFetch<SignupResponse>('/auth/signup', { method: 'POST', body: JSON.stringify(req) })
}

// Phase 4: self-service session management -- the caller's own active
// sessions only.
export interface SessionInfo {
  id: string
  created_at: string
  expires_at: string
  last_seen_at: string
  is_current: boolean
}

export function fetchSessions(): Promise<{ sessions: SessionInfo[] }> {
  return apiFetch<{ sessions: SessionInfo[] }>('/auth/sessions')
}

export function revokeSession(sessionId: string): Promise<{ revoked: boolean }> {
  return apiFetch<{ revoked: boolean }>(`/auth/sessions/${sessionId}`, { method: 'DELETE' })
}
