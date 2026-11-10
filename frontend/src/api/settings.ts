import { apiFetch } from '@/api/client'

export interface TenantSettings {
  default_currency_code: string
  default_timezone: string
  ai_enabled: boolean
  ai_provider: string
  ai_api_key_configured: boolean
}

export interface TenantSettingsUpdateRequest {
  default_currency_code?: string
  default_timezone?: string
  ai_enabled?: boolean
  ai_api_key?: string
}

export function getSettings(): Promise<TenantSettings> {
  return apiFetch<TenantSettings>('/settings')
}

export function updateSettings(req: TenantSettingsUpdateRequest): Promise<TenantSettings> {
  return apiFetch<TenantSettings>('/settings', { method: 'PATCH', body: JSON.stringify(req) })
}

// Tier 1 / ADR-053: schema/admin-assignment only -- read-only here, the
// tenant side has no write endpoint (assignment is platform-admin-only).
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

export function getSubscription(): Promise<Subscription> {
  return apiFetch<Subscription>('/settings/subscription')
}
