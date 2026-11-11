import { apiFetch } from '@/api/client'

export interface ServiceToken {
  id: string
  name: string
  scope: string
  created_at: string
  last_used_at: string | null
  revoked_at: string | null
}

export interface ServiceTokenCreated {
  token: ServiceToken
  raw_value: string
}

export function listServiceTokens(): Promise<ServiceToken[]> {
  return apiFetch<ServiceToken[]>('/service-tokens')
}

export function createServiceToken(name: string): Promise<ServiceTokenCreated> {
  return apiFetch<ServiceTokenCreated>('/service-tokens', {
    method: 'POST',
    body: JSON.stringify({ name }),
  })
}

export function revokeServiceToken(tokenId: string): Promise<{ revoked: boolean }> {
  return apiFetch<{ revoked: boolean }>(`/service-tokens/${tokenId}`, { method: 'DELETE' })
}
