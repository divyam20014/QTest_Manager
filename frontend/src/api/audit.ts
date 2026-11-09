import { API_BASE_URL, apiFetch } from '@/api/client'

export interface AuditLogEntry {
  id: string
  tenant_id: string
  user_id: string | null
  user_name: string | null
  action: string
  entity_type: string
  entity_id: string
  metadata: Record<string, unknown> | null
  prev_hash: string
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
  entity_id?: string
  user_id?: string
  date_from?: string
  date_to?: string
}

function buildAuditParams(filters: AuditLogFilters): URLSearchParams {
  const params = new URLSearchParams()
  if (filters.action) params.set('action', filters.action)
  if (filters.entity_type) params.set('entity_type', filters.entity_type)
  if (filters.entity_id) params.set('entity_id', filters.entity_id)
  if (filters.user_id) params.set('user_id', filters.user_id)
  if (filters.date_from) params.set('date_from', filters.date_from)
  if (filters.date_to) params.set('date_to', filters.date_to)
  return params
}

export function listAuditLogs(filters: AuditLogFilters = {}): Promise<AuditLogEntry[]> {
  const query = buildAuditParams(filters).toString()
  return apiFetch<AuditLogEntry[]>(`/audit-logs${query ? `?${query}` : ''}`)
}

export function verifyAuditChain(): Promise<ChainVerificationResult> {
  return apiFetch<ChainVerificationResult>('/audit-logs/verify-chain')
}

export function auditExportUrl(filters: AuditLogFilters = {}): string {
  const query = buildAuditParams(filters).toString()
  return `${API_BASE_URL}/audit-logs/export${query ? `?${query}` : ''}`
}

export function fetchOwnHistory(): Promise<AuditLogEntry[]> {
  return apiFetch<AuditLogEntry[]>('/users/me/history')
}
