import { apiFetch } from '@/api/client'

export interface ScimToken {
  id: string
  created_at: string
  last_used_at: string | null
  revoked_at: string | null
}

export interface ScimTokenCreated {
  id: string
  token: string
}

export function listScimTokens(): Promise<ScimToken[]> {
  return apiFetch<ScimToken[]>('/scim-tokens')
}

export function createScimToken(): Promise<ScimTokenCreated> {
  return apiFetch<ScimTokenCreated>('/scim-tokens', { method: 'POST' })
}

export function revokeScimToken(tokenId: string): Promise<{ revoked: boolean }> {
  return apiFetch<{ revoked: boolean }>(`/scim-tokens/${tokenId}`, { method: 'DELETE' })
}
