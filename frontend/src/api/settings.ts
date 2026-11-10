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
