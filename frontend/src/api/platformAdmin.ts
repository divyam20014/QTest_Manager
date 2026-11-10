import { API_BASE_URL, type ApiEnvelope, ApiError } from '@/api/client'

// Platform Administration is a deliberately separate auth plane from tenant
// sessions (ADR-008): HTTP Basic against platform_admins, not the session
// cookie. Credentials are supplied per-call, never persisted.
export interface PlatformCredentials {
  email: string
  password: string
}

export interface Tenant {
  id: string
  name: string
  status: 'pending' | 'approved' | 'suspended'
  default_currency_code: string
  default_timezone: string
  created_at: string
}

export interface TenantCreateRequest {
  tenant_name: string
  admin_name: string
  admin_email: string
  admin_password: string
}

async function platformFetch<T>(
  path: string,
  credentials: PlatformCredentials,
  init?: RequestInit,
): Promise<T> {
  const basic = btoa(`${credentials.email}:${credentials.password}`)
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/json',
      ...init?.headers,
    },
  })
  const body = (await response.json()) as ApiEnvelope<T>
  if (!response.ok || body.error) {
    throw new ApiError(body.error?.message ?? 'Request failed', body.error?.code ?? 'unknown')
  }
  return body.data as T
}

export function listTenants(credentials: PlatformCredentials): Promise<Tenant[]> {
  return platformFetch<Tenant[]>('/platform/tenants', credentials)
}

export function createTenant(
  credentials: PlatformCredentials,
  req: TenantCreateRequest,
): Promise<{ tenant: Tenant; admin_user_id: string }> {
  return platformFetch('/platform/tenants', credentials, {
    method: 'POST',
    body: JSON.stringify(req),
  })
}

export function updateTenantStatus(
  credentials: PlatformCredentials,
  tenantId: string,
  status: Tenant['status'],
): Promise<Tenant> {
  return platformFetch<Tenant>(`/platform/tenants/${tenantId}/status`, credentials, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
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

export function listPlans(credentials: PlatformCredentials): Promise<Plan[]> {
  return platformFetch<Plan[]>('/platform/plans', credentials)
}

export function getTenantSubscription(
  credentials: PlatformCredentials,
  tenantId: string,
): Promise<Subscription> {
  return platformFetch<Subscription>(`/platform/tenants/${tenantId}/subscription`, credentials)
}

export function assignTenantSubscription(
  credentials: PlatformCredentials,
  tenantId: string,
  req: { plan_code: string; status: Subscription['status']; seat_count: number },
): Promise<Subscription> {
  return platformFetch<Subscription>(`/platform/tenants/${tenantId}/subscription`, credentials, {
    method: 'PUT',
    body: JSON.stringify(req),
  })
}
