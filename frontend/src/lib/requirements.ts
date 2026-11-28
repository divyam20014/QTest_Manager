// Phase 3: small requirement rules shared by the screens (mirroring app/services/requirement_service.py).
import type { RequirementStatus, RequirementUpdateRequest } from '@/api/requirements'

export const REQUIREMENT_STATUS_LABEL: Record<RequirementStatus, string> = {
  draft: 'Draft',
  approved: 'Approved',
  retired: 'Retired',
}

export const REQUIREMENT_STATUS_TONE = { draft: 'neutral', approved: 'positive', retired: 'warning' } as const

export interface RequirementForm {
  title: string
  description: string
  requirement_type: string
  priority: string
  status: RequirementStatus
  /** '' means nobody. */
  owner_id: string
  acceptance_criteria: string[]
}

export const MAX_CRITERIA = 50

/** As the server keeps them: trimmed, and empty rows dropped. */
export function cleanCriteria(criteria: string[]): string[] {
  return criteria.map((c) => c.trim()).filter(Boolean)
}

function criteriaChanged(opened: RequirementForm, values: RequirementForm): boolean {
  return JSON.stringify(cleanCriteria(values.acceptance_criteria)) !== JSON.stringify(opened.acceptance_criteria)
}

/** Only what the user changed, so a save does not send back values they never touched. */
export function requirementChanges(opened: RequirementForm, values: RequirementForm): RequirementUpdateRequest {
  const changes: RequirementUpdateRequest = {}
  if (values.title !== opened.title) changes.title = values.title
  if (values.description !== opened.description) changes.description = values.description
  if (values.requirement_type !== opened.requirement_type) changes.requirement_type = values.requirement_type
  if (values.priority !== opened.priority) changes.priority = values.priority
  if (values.status !== opened.status) changes.status = values.status
  if (values.owner_id !== opened.owner_id) changes.owner_id = values.owner_id || null
  if (criteriaChanged(opened, values)) changes.acceptance_criteria = cleanCriteria(values.acceptance_criteria)
  return changes
}

/** New wording on an approved requirement sends it back to Draft, unless it is being retired. */
export function approvalWillBeLost(opened: RequirementForm, values: RequirementForm): boolean {
  const reworded = values.title !== opened.title || values.description !== opened.description || criteriaChanged(opened, values)
  return reworded && opened.status === 'approved' && values.status !== 'retired'
}
