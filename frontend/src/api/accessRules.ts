import { apiFetch } from '@/api/client'

export type AccessRuleType = 'freeze_window' | 'environment_restriction'

export interface AccessRule {
  id: string
  name: string
  enabled: boolean
  rule_type: AccessRuleType
  project_id: string | null
  environment: string | null
  starts_at: string | null
  ends_at: string | null
  blocked_actions: string[]
  exempt_roles: string[]
  reason: string
  created_by: string | null
  created_at: string
  updated_at: string
}

export interface AccessRuleInput {
  name: string
  enabled: boolean
  rule_type: AccessRuleType
  project_id: string | null
  environment: string | null
  starts_at: string | null
  ends_at: string | null
  blocked_actions: string[]
  exempt_roles: string[]
  reason: string
}

/** What a signed-in user sees for an active rule (banner data only). */
export interface ActiveAccessRule {
  id: string
  rule_type: AccessRuleType
  project_id: string | null
  environment: string | null
  reason: string
  ends_at: string | null
  blocked_actions: string[]
}

export function listAccessRules(): Promise<AccessRule[]> {
  return apiFetch<AccessRule[]>('/access-rules')
}

export function listActiveAccessRules(): Promise<ActiveAccessRule[]> {
  return apiFetch<ActiveAccessRule[]>('/access-rules/active')
}

export function createAccessRule(input: AccessRuleInput): Promise<AccessRule> {
  return apiFetch<AccessRule>('/access-rules', {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export function updateAccessRule(id: string, input: Partial<AccessRuleInput>): Promise<AccessRule> {
  return apiFetch<AccessRule>(`/access-rules/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  })
}

export function deleteAccessRule(id: string): Promise<{ deleted: boolean }> {
  return apiFetch<{ deleted: boolean }>(`/access-rules/${id}`, {
    method: 'DELETE',
  })
}
