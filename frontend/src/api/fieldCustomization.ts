import { apiFetch } from '@/api/client'

export type FieldKey = 'defect_severity' | 'test_case_priority' | 'defect_priority'
export type StatusEntityType = 'test_case' | 'defect'
export type CustomFieldEntityType = 'test_case' | 'defect' | 'requirement'
export type CustomFieldType = 'text' | 'number' | 'boolean' | 'date' | 'select' | 'multi_select'

export interface FieldOption {
  id: string
  field_key: FieldKey
  code: string
  label: string
  color: string | null
  sort_order: number
}

export interface FieldOptionCreateRequest {
  field_key: FieldKey
  code: string
  label: string
  color?: string | null
}

export interface FieldOptionUpdateRequest {
  label?: string
  color?: string | null
  sort_order?: number
}

export interface StatusLabel {
  entity_type: StatusEntityType
  status_code: string
  label: string
}

export interface CustomFieldDefinition {
  id: string
  entity_type: CustomFieldEntityType
  field_key: string
  label: string
  field_type: CustomFieldType
  options: string[] | null
  required: boolean
  sort_order: number
  created_at: string
}

export interface CustomFieldDefinitionCreateRequest {
  entity_type: CustomFieldEntityType
  field_key: string
  label: string
  field_type: CustomFieldType
  options?: string[] | null
  required?: boolean
  sort_order?: number
}

export function listFieldOptions(fieldKey: FieldKey): Promise<FieldOption[]> {
  return apiFetch<FieldOption[]>(`/field-options?field_key=${fieldKey}`)
}

export function createFieldOption(req: FieldOptionCreateRequest): Promise<FieldOption> {
  return apiFetch<FieldOption>('/field-options', { method: 'POST', body: JSON.stringify(req) })
}

export function updateFieldOption(id: string, req: FieldOptionUpdateRequest): Promise<FieldOption> {
  return apiFetch<FieldOption>(`/field-options/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(req),
  })
}

export function deleteFieldOption(id: string): Promise<{ deleted: boolean }> {
  return apiFetch<{ deleted: boolean }>(`/field-options/${id}`, { method: 'DELETE' })
}

export function listStatusLabels(entityType: StatusEntityType): Promise<StatusLabel[]> {
  return apiFetch<StatusLabel[]>(`/status-labels?entity_type=${entityType}`)
}

export function setStatusLabel(
  entityType: StatusEntityType,
  statusCode: string,
  label: string | null,
): Promise<StatusLabel> {
  return apiFetch<StatusLabel>('/status-labels', {
    method: 'PUT',
    body: JSON.stringify({ entity_type: entityType, status_code: statusCode, label }),
  })
}

export function listCustomFieldDefinitions(
  entityType: CustomFieldEntityType,
): Promise<CustomFieldDefinition[]> {
  return apiFetch<CustomFieldDefinition[]>(`/custom-fields/definitions?entity_type=${entityType}`)
}

export function createCustomFieldDefinition(
  req: CustomFieldDefinitionCreateRequest,
): Promise<CustomFieldDefinition> {
  return apiFetch<CustomFieldDefinition>('/custom-fields/definitions', {
    method: 'POST',
    body: JSON.stringify(req),
  })
}

export function deleteCustomFieldDefinition(id: string): Promise<{ deleted: boolean }> {
  return apiFetch<{ deleted: boolean }>(`/custom-fields/definitions/${id}`, { method: 'DELETE' })
}

export function getCustomFieldValues(
  ownerType: CustomFieldEntityType,
  ownerId: string,
): Promise<{ values: Record<string, unknown> }> {
  return apiFetch<{ values: Record<string, unknown> }>(`/custom-fields/values/${ownerType}/${ownerId}`)
}

export function setCustomFieldValues(
  ownerType: CustomFieldEntityType,
  ownerId: string,
  values: Record<string, unknown>,
): Promise<{ values: Record<string, unknown> }> {
  return apiFetch<{ values: Record<string, unknown> }>(`/custom-fields/values/${ownerType}/${ownerId}`, {
    method: 'PUT',
    body: JSON.stringify({ values }),
  })
}
