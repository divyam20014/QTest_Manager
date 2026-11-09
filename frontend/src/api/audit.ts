import { apiFetch } from '@/api/client'

export interface AuditLogEntry {
  id: string
  user_id: string | null
  user_name: string | null
  action: string
  entity_type: string
  entity_id: string
  record_hash: string
  created_at: string
}

export interface ChainVerificationResult {
  valid: boolean
  checked_count: number
  broken_at_id: string | null
}

export interface AuditLogFilters {
  action?: string
  entity_type?: string
}

export function listAuditLogs(filters: AuditLogFilters = {}): Promise<AuditLogEntry[]> {
  const params = new URLSearchParams()
  if (filters.action) params.set('action', filters.action)
  if (filters.entity_type) params.set('entity_type', filters.entity_type)
  const query = params.toString()
  return apiFetch<AuditLogEntry[]>(`/audit-logs${query ? `?${query}` : ''}`)
}

export function verifyAuditChain(): Promise<ChainVerificationResult> {
  return apiFetch<ChainVerificationResult>('/audit-logs/verify-chain')
}
