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

// ADR-085: signed checkpoints over the audit chain.
export type CheckpointFailureReason =
  | 'signature_invalid'
  | 'anchor_missing'
  | 'anchor_hash_mismatch'
  | 'count_mismatch'
  | 'checkpoint_chain_broken'

export interface CheckpointFailure {
  checkpoint_id: string
  reason: CheckpointFailureReason
}

export interface ChainVerificationResult {
  valid: boolean
  checked_count: number
  broken_at_id: string | null
  checkpoints_checked: number
  checkpoint_failure: CheckpointFailure | null
}

export interface AuditCheckpoint {
  id: string
  scope: string
  last_record_id: string
  last_created_at: string
  record_count: number
  head_hash: string
  prev_checkpoint_hash: string
  checkpoint_hash: string
  signature: string
  created_at: string
}

export interface CreateCheckpointResult {
  created: boolean
  reason: string | null
  checkpoint: AuditCheckpoint | null
}

export function createAuditCheckpoint(): Promise<CreateCheckpointResult> {
  return apiFetch<CreateCheckpointResult>('/audit-logs/checkpoints', { method: 'POST' })
}

export const AUDIT_CHECKPOINT_EXPORT_PATH = '/audit-logs/checkpoints/export'

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

export const AUDIT_PAGE_SIZE = 50

export function listAuditLogs(
  filters: AuditLogFilters = {},
  page: { limit?: number; offset?: number } = {},
): Promise<AuditLogEntry[]> {
  const params = buildAuditParams(filters)
  if (page.limit) params.set('limit', String(page.limit))
  if (page.offset) params.set('offset', String(page.offset))
  const query = params.toString()
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
