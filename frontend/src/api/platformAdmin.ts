import type { ChainVerificationResult, CreateCheckpointResult } from '@/api/audit'
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
  // ADR-080: whether a one-time enrolment code is usable, and when it lapses.
  // The code itself is never returned by the list.
  enrolment_code_active: boolean
  enrolment_code_expires_at: string | null
  // ADR-081: whether an admin-issued password-reset code is usable, and when it
  // lapses (null once consumed or never issued). Never the code itself.
  password_reset_code_active: boolean
  password_reset_code_expires_at: string | null
}

/** Create / reset-MFA / re-issue / password-reset responses carry the plaintext
 * one-time code -- the only time it is ever visible. */
export interface PlatformAdminWithCode extends PlatformAdminAccount {
  enrolment_code: string | null
  password_reset_code?: string | null
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

/** ADR-083: set by the signed-in console. Called when the server answers 403
 * `step_up_required`; resolves true once the admin has entered a fresh code (the
 * request is then retried once) and false when they cancel. */
type StepUpHandler = () => Promise<boolean>
let stepUpHandler: StepUpHandler | null = null
export function setStepUpHandler(handler: StepUpHandler | null): void {
  stepUpHandler = handler
}
export const STEP_UP_REQUIRED_CODE = 'step_up_required'
export const SESSION_IDLE_CODE = 'session_idle_expired'

async function platformFetch<T>(
  path: string,
  init?: RequestInit,
  stepUpRetried = false,
): Promise<T> {
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
    const code = body?.error?.code ?? 'unknown'
    if (
      response.status === 403 &&
      code === STEP_UP_REQUIRED_CODE &&
      !stepUpRetried &&
      stepUpHandler
    ) {
      if (await stepUpHandler()) return platformFetch<T>(path, init, true)
    }
    const idle = response.status === 401 && code === SESSION_IDLE_CODE
    const sessionGone =
      response.status === 401 &&
      (!path.startsWith('/platform/auth/') || path.startsWith('/platform/auth/sessions'))
    if (idle || sessionGone) {
      window.dispatchEvent(
        new CustomEvent(PLATFORM_SESSION_EXPIRED_EVENT, {
          detail: { message: idle ? (body?.error?.message ?? null) : null },
        }),
      )
    }
    throw new ApiError(body?.error?.message ?? 'Request failed', code)
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
  step_up_expires_at?: string | null
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

export function startPlatformEnrolment(enrolmentCode: string): Promise<PlatformEnrolStart> {
  return platformFetch('/platform/auth/mfa/enroll/start', {
    method: 'POST',
    body: JSON.stringify({ enrolment_code: enrolmentCode }),
  })
}

export function finishPlatformEnrolment(
  code: string,
  enrolmentCode: string,
): Promise<PlatformEnrolFinish> {
  return platformFetch('/platform/auth/mfa/enroll/verify', {
    method: 'POST',
    body: JSON.stringify({ code, enrolment_code: enrolmentCode }),
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

/** Exactly one of `code` (TOTP) or `recovery_code`. */
export type SecondFactor = { code: string } | { recovery_code: string }

/** ADR-081: change your own password (current password + fresh authenticator or
 * recovery code). Other sessions of this admin are revoked; this one stays. */
export function changePlatformPassword(
  currentPassword: string,
  newPassword: string,
  factor: SecondFactor,
): Promise<{ password_changed: boolean }> {
  return platformFetch('/platform/auth/password/change', {
    method: 'POST',
    body: JSON.stringify({
      current_password: currentPassword,
      new_password: newPassword,
      ...factor,
    }),
  })
}

/** ADR-081: complete an admin-issued reset. The authenticator factor is only
 * needed (and only checked) when the account has MFA enabled. */
export function resetPlatformPassword(req: {
  email: string
  resetCode: string
  newPassword: string
  factor: SecondFactor | null
}): Promise<{ password_reset: boolean }> {
  return platformFetch('/platform/auth/password/reset', {
    method: 'POST',
    body: JSON.stringify({
      email: req.email,
      reset_code: req.resetCode,
      new_password: req.newPassword,
      ...(req.factor ?? {}),
    }),
  })
}

/** ADR-083: prove possession of the authenticator so sensitive actions are
 * allowed for the next few minutes. */
export function stepUpPlatform(factor: SecondFactor): Promise<{ step_up_expires_at: string }> {
  return platformFetch('/platform/auth/step-up', {
    method: 'POST',
    body: JSON.stringify(factor),
  })
}

/** ADR-083: one of the signed-in admin's own live sessions. */
export interface PlatformSessionEntry {
  id: string
  created_at: string
  last_seen_at: string | null
  ip_address: string | null
  user_agent: string | null
  current: boolean
}

export function listPlatformSessions(): Promise<PlatformSessionEntry[]> {
  return platformFetch('/platform/auth/sessions')
}

export function revokePlatformSession(id: string): Promise<{ revoked: boolean; current: boolean }> {
  return platformFetch(`/platform/auth/sessions/${id}`, { method: 'DELETE' })
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
}): Promise<PlatformAdminWithCode> {
  return platformFetch<PlatformAdminWithCode>('/platform/admins', {
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

export function resetPlatformAdminMfa(adminId: string): Promise<PlatformAdminWithCode> {
  return platformFetch<PlatformAdminWithCode>(`/platform/admins/${adminId}/reset-mfa`, {
    method: 'POST',
  })
}

export function reissuePlatformAdminEnrolmentCode(adminId: string): Promise<PlatformAdminWithCode> {
  return platformFetch<PlatformAdminWithCode>(`/platform/admins/${adminId}/enrolment-code`, {
    method: 'POST',
  })
}

export function issuePlatformAdminPasswordResetCode(
  adminId: string,
): Promise<PlatformAdminWithCode> {
  return platformFetch<PlatformAdminWithCode>(`/platform/admins/${adminId}/password-reset-code`, {
    method: 'POST',
  })
}

// ADR-082: read-only platform audit trail.
export type PlatformAuditOutcome = 'success' | 'failure'

export interface PlatformAuditEvent {
  id: string
  created_at: string
  event_type: string
  actor_admin_id: string | null
  actor_email: string | null
  target_admin_id: string | null
  ip: string | null
  outcome: PlatformAuditOutcome
  details: Record<string, string | number | boolean> | null
}

export interface PlatformAuditEventList {
  items: PlatformAuditEvent[]
  total: number
}

export type PlatformAuditChainResult = ChainVerificationResult

export function createPlatformAuditCheckpoint(): Promise<CreateCheckpointResult> {
  return platformFetch<CreateCheckpointResult>('/platform/audit-events/checkpoints', {
    method: 'POST',
  })
}

export const PLATFORM_AUDIT_CHECKPOINT_EXPORT_PATH = '/platform/audit-events/checkpoints/export'

export function listPlatformAuditEvents(
  params: {
    event_type?: string
    outcome?: PlatformAuditOutcome | ''
    actor_email?: string
    page?: number
    page_size?: number
  } = {},
): Promise<PlatformAuditEventList> {
  const query = new URLSearchParams()
  if (params.event_type) query.set('event_type', params.event_type)
  if (params.outcome) query.set('outcome', params.outcome)
  if (params.actor_email) query.set('actor_email', params.actor_email)
  if (params.page) query.set('page', String(params.page))
  if (params.page_size) query.set('page_size', String(params.page_size))
  const qs = query.toString()
  return platformFetch<PlatformAuditEventList>(`/platform/audit-events${qs ? `?${qs}` : ''}`)
}

export function verifyPlatformAuditChain(): Promise<PlatformAuditChainResult> {
  return platformFetch<PlatformAuditChainResult>('/platform/audit-events/verify')
}
