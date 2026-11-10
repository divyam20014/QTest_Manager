import { apiFetch } from '@/api/client'

export interface SsoStatus {
  enabled: boolean
}

export interface SsoConfig {
  enabled: boolean
  issuer: string | null
  client_id: string | null
  default_role_code: string
}

export interface SsoConfigUpsertRequest {
  enabled: boolean
  issuer: string
  client_id: string
  client_secret?: string
  default_role_code: string
}

// Public -- used by the login page before any session exists.
export function getSsoStatus(tenantId: string): Promise<SsoStatus> {
  return apiFetch<SsoStatus>(`/auth/sso/${tenantId}/status`)
}

export function getSsoConfig(): Promise<SsoConfig> {
  return apiFetch<SsoConfig>('/sso/config')
}

export function updateSsoConfig(req: SsoConfigUpsertRequest): Promise<SsoConfig> {
  return apiFetch<SsoConfig>('/sso/config', { method: 'PUT', body: JSON.stringify(req) })
}
