import { API_BASE_URL, type ApiEnvelope, ApiError } from '@/api/client'

// Platform Administration is a deliberately separate auth plane from tenant
// sessions (ADR-008). ADR-074: password + TOTP MFA exchanged for an HttpOnly,
// SameSite=Strict session cookie scoped to /api/v1/platform. The browser keeps
// the cookie; this code never sees, stores or re-sends the password.

export type TenantStatus = 'pending' | 'approved' | 'suspended' | 'inactive'

export interface Tenant {
  id: string
  name: string
  status: TenantStatus
  default_currency_code: string
  default_timezone: string
  // Tier 4 / ADR-054: data residency readiness metadata only (PV-11.6) --
  // no per-region deployment topology exists yet.
  data_region: string
  primary_domain: string | null
  created_at: string
}

export interface TenantListResponse {
  items: Tenant[]
  total: number
}

export interface TenantListParams {
  search?: string
  status?: TenantStatus | ''
  page?: number
  page_size?: number
}

export interface PlatformAdminAccount {
  id: string
  email: string
  is_active: boolean
  created_at: string
  mfa_enabled: boolean
}

export interface PlatformAdminListResponse {
  items: PlatformAdminAccount[]
  total: number
}

export interface TenantCreateRequest {
  tenant_name: string
  admin_name: string
  admin_email: string
  admin_password: string
  data_region?: string
  primary_domain?: string
}

// Fired when a console request finds the session gone (expired / revoked /
// signed out elsewhere) so the page can fall back to the sign-in form.
// React Query key under which the current Platform Admin session is cached.
export const PLATFORM_SESSION_KEY = ['platform-session'] as const

export const PLATFORM_SESSION_EXPIRED_EVENT = 'qth:platform-session-expired'

async function platformFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...init?.headers,
    },
  })
  let body: ApiEnvelope<T> | null = null
  try {
    body = (await response.json()) as ApiEnvelope<T>
  } catch {
    body = null
  }
  if (!response.ok || body?.error) {
    if (response.status === 401 && !path.startsWith('/platform/auth/')) {
      window.dispatchEvent(new Event(PLATFORM_SESSION_EXPIRED_EVENT))
    }
    throw new ApiError(body?.error?.message ?? 'Request failed', body?.error?.code ?? 'unknown')
  }
  return body?.data as T
}

// --- sign-in (ADR-074) ------------------------------------------------------

export type PlatformStage = 'password_ok' | 'mfa_verified'

export interface PlatformSessionInfo {
  email: string
  stage: PlatformStage
  mfa_enrolled: boolean
  recovery_codes_remaining: number | null
}

export interface PlatformEnrolStart {
  secret: string
  otpauth_uri: string
  issuer: string
  account: string
}

export interface PlatformEnrolFinish {
  email: string
  stage: PlatformStage
  recovery_codes: string[]
}

export function platformLogin(email: string, password: string): Promise<PlatformSessionInfo> {
  return platformFetch('/platform/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  })
}

export function getPlatformSession(): Promise<PlatformSessionInfo> {
  return platformFetch('/platform/auth/me')
}

export function startPlatformEnrolment(): Promise<PlatformEnrolStart> {
  return platformFetch('/platform/auth/mfa/enroll/start', { method: 'POST' })
}

export function finishPlatformEnrolment(code: string): Promise<PlatformEnrolFinish> {
  return platformFetch('/platform/auth/mfa/enroll/verify', {
    method: 'POST',
    body: JSON.stringify({ code }),
  })
}

export function verifyPlatformMfa(
  credential: { code: string } | { recovery_code: string },
): Promise<PlatformSessionInfo> {
  return platformFetch('/platform/auth/mfa/verify', {
    method: 'POST',
    body: JSON.stringify(credential),
  })
}

export function platformLogout(): Promise<{ signed_out: boolean }> {
  return platformFetch('/platform/auth/logout', { method: 'POST' })
}

export function listTenants(params: TenantListParams = {}): Promise<TenantListResponse> {
  const query = new URLSearchParams()
  if (params.search) query.set('search', params.search)
  if (params.status) query.set('status', params.status)
  if (params.page) query.set('page', String(params.page))
  if (params.page_size) query.set('page_size', String(params.page_size))
  const qs = query.toString()
  return platformFetch<TenantListResponse>(`/platform/tenants${qs ? `?${qs}` : ''}`)
}

export function createTenant(
  req: TenantCreateRequest,
): Promise<{ tenant: Tenant; admin_user_id: string }> {
  return platformFetch('/platform/tenants', {
    method: 'POST',
    body: JSON.stringify(req),
  })
}

export function updateTenantStatus(tenantId: string, status: Tenant['status']): Promise<Tenant> {
  return platformFetch<Tenant>(`/platform/tenants/${tenantId}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  })
}

export function updateTenantDataRegion(tenantId: string, dataRegion: string): Promise<Tenant> {
  return platformFetch<Tenant>(`/platform/tenants/${tenantId}/data-region`, {
    method: 'PATCH',
    body: JSON.stringify({ data_region: dataRegion }),
  })
}

// Tier 1 / ADR-053: subscription schema + platform-admin assignment only --
// no payment gateway, no billing engine.
export interface Plan {
  id: string
  code: string
  name: string
  seat_limit: number | null
  storage_limit_mb: number | null
  ai_monthly_request_limit: number | null
  is_active: boolean
}

export interface Subscription {
  id: string
  plan: Plan
  status: 'trialing' | 'active' | 'past_due' | 'canceled'
  seat_count: number
  current_period_start: string
  current_period_end: string | null
}

export function listPlans(): Promise<Plan[]> {
  return platformFetch<Plan[]>('/platform/plans')
}

export function getTenantSubscription(tenantId: string): Promise<Subscription> {
  return platformFetch<Subscription>(`/platform/tenants/${tenantId}/subscription`)
}

export function assignTenantSubscription(
  tenantId: string,
  req: {
    plan_code: string
    status: Subscription['status']
    seat_count: number
  },
): Promise<Subscription> {
  return platformFetch<Subscription>(`/platform/tenants/${tenantId}/subscription`, {
    method: 'PUT',
    body: JSON.stringify(req),
  })
}

// Platform Admin UI/UX pass: self-management, closing the gap where the
// only way to provision/deactivate a platform admin was the out-of-band
// CLI script.
export function listPlatformAdmins(
  params: { page?: number; page_size?: number } = {},
): Promise<PlatformAdminListResponse> {
  const query = new URLSearchParams()
  if (params.page) query.set('page', String(params.page))
  if (params.page_size) query.set('page_size', String(params.page_size))
  const qs = query.toString()
  return platformFetch<PlatformAdminListResponse>(`/platform/admins${qs ? `?${qs}` : ''}`)
}

export function createPlatformAdmin(req: {
  email: string
  password: string
}): Promise<PlatformAdminAccount> {
  return platformFetch<PlatformAdminAccount>('/platform/admins', {
    method: 'POST',
    body: JSON.stringify(req),
  })
}

export function updatePlatformAdminActive(
  adminId: string,
  isActive: boolean,
): Promise<PlatformAdminAccount> {
  return platformFetch<PlatformAdminAccount>(`/platform/admins/${adminId}`, {
    method: 'PATCH',
    body: JSON.stringify({ is_active: isActive }),
  })
}

export type LeadKind = 'demo' | 'contact' | 'pricing' | 'enterprise'
export type LeadStatus = 'new' | 'contacted' | 'closed'

export interface MarketingLead {
  id: string
  kind: LeadKind
  full_name: string
  business_email: string
  company: string
  job_role: string | null
  team_size: string | null
  primary_requirement: string | null
  message: string | null
  source_page: string | null
  status: LeadStatus
  created_at: string
  updated_at: string
}

export interface LeadListResponse {
  items: MarketingLead[]
  total: number
}

export function listLeads(
  params: {
    kind?: LeadKind | ''
    status?: LeadStatus | ''
    page?: number
    page_size?: number
  } = {},
): Promise<LeadListResponse> {
  const query = new URLSearchParams()
  if (params.kind) query.set('kind', params.kind)
  if (params.status) query.set('status', params.status)
  if (params.page) query.set('page', String(params.page))
  if (params.page_size) query.set('page_size', String(params.page_size))
  const qs = query.toString()
  return platformFetch<LeadListResponse>(`/platform/leads${qs ? `?${qs}` : ''}`)
}

export function updateLeadStatus(leadId: string, status: LeadStatus): Promise<MarketingLead> {
  return platformFetch<MarketingLead>(`/platform/leads/${leadId}`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  })
}

export function resetPlatformAdminMfa(adminId: string): Promise<PlatformAdminAccount> {
  return platformFetch<PlatformAdminAccount>(`/platform/admins/${adminId}/reset-mfa`, {
    method: 'POST',
  })
}
