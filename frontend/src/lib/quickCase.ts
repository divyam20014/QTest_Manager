// Pure helpers for the quick-create test case dialog (ADR-106).

export interface QuickStep {
  action: string
  expected: string
}

export interface QuickDraft {
  title: string
  priority: string
  module_id: string
  steps: QuickStep[]
}

export const MAX_QUICK_STEPS = 3

export function emptyDraft(priority = '', moduleId = ''): QuickDraft {
  return { title: '', priority, module_id: moduleId, steps: [{ action: '', expected: '' }] }
}

/** "Create and add another": keep priority and module, clear title and steps. */
export function carryOver(draft: QuickDraft): QuickDraft {
  return emptyDraft(draft.priority, draft.module_id)
}

export function addStepRow(steps: QuickStep[]): QuickStep[] {
  return steps.length >= MAX_QUICK_STEPS ? steps : [...steps, { action: '', expected: '' }]
}

/** Always keeps at least one row. */
export function removeStepRow(steps: QuickStep[], index: number): QuickStep[] {
  if (steps.length <= 1) return steps
  return steps.filter((_, i) => i !== index)
}

export interface QuickErrors {
  title?: string
  priority?: string
  steps?: string
  /** Index of the first half-filled step row, if any. */
  stepRow?: number
}

/** Same rules as the full form / API: title >= 5, a priority, and >= 1 complete step. */
export function validateDraft(draft: QuickDraft): QuickErrors {
  const errors: QuickErrors = {}
  if (draft.title.trim().length < 5) errors.title = 'At least 5 characters'
  if (!draft.priority) errors.priority = 'Required'
  const partial = draft.steps.findIndex((s) => !!s.action.trim() !== !!s.expected.trim())
  if (partial >= 0) {
    errors.steps = `Step ${partial + 1}: enter both an action and an expected outcome.`
    errors.stepRow = partial
  } else if (cleanSteps(draft.steps).length === 0) {
    errors.steps = 'Add at least one step (action and expected outcome).'
    errors.stepRow = 0
  }
  return errors
}

export function cleanSteps(steps: QuickStep[]): QuickStep[] {
  return steps
    .filter((s) => s.action.trim() && s.expected.trim())
    .map((s) => ({ action: s.action.trim(), expected: s.expected.trim() }))
}

/** Values handed to the full form via "More options" (nothing entered is lost). */
export function draftToFormValues<T extends Record<string, unknown>>(draft: QuickDraft, base: T): T & QuickDraft {
  const steps = draft.steps.some((s) => s.action || s.expected) ? draft.steps : (base.steps as QuickStep[])
  return { ...base, title: draft.title, priority: draft.priority, module_id: draft.module_id, steps }
}

export interface PickOption {
  id: string
  label: string
}

/** Typeahead filter: case-insensitive substring, already-selected ids hidden, capped. */
export function filterOptions(options: PickOption[], query: string, selectedIds: string[], limit = 50): PickOption[] {
  const q = query.trim().toLowerCase()
  return options.filter((o) => !selectedIds.includes(o.id) && (!q || o.label.toLowerCase().includes(q))).slice(0, limit)
}
