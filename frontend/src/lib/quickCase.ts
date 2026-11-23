// Pure helpers for the quick-create test case dialog (ADR-106). Quick add asks for
// exactly the fields the API requires on create (ADR-116): module, title, priority,
// preconditions, test data, expected result and at least one step -- everything else
// has a default and can be added later on the full form (the "More options" link).
import { newStep, type BuilderStep } from '@/lib/stepBuilder'
import type { TestCaseFormValues } from '@/lib/testCaseForm'

export interface QuickStep {
  action: string
  expected: string
}

export interface QuickDraft {
  title: string
  priority: string
  module_id: string
  preconditions: string
  test_data: string
  expected_result: string
  steps: QuickStep[]
}

export const MAX_QUICK_STEPS = 3

export function emptyDraft(priority = '', moduleId = ''): QuickDraft {
  return {
    title: '',
    priority,
    module_id: moduleId,
    preconditions: '',
    test_data: '',
    expected_result: '',
    steps: [{ action: '', expected: '' }],
  }
}

/** "Create and add another": keep priority and module (and the setup text), clear title, result and steps. */
export function carryOver(draft: QuickDraft): QuickDraft {
  return {
    ...emptyDraft(draft.priority, draft.module_id),
    preconditions: draft.preconditions,
    test_data: draft.test_data,
  }
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
  module?: string
  preconditions?: string
  test_data?: string
  expected_result?: string
  steps?: string
  /** Index of the first half-filled step row, if any. */
  stepRow?: number
}

/** Same rules as the full form / API: module, title >= 5, priority, preconditions, test data, expected result and >= 1 complete step. */
export function validateDraft(draft: QuickDraft): QuickErrors {
  const errors: QuickErrors = {}
  if (draft.title.trim().length < 5) errors.title = 'At least 5 characters'
  if (!draft.priority) errors.priority = 'Required'
  if (!draft.module_id) errors.module = 'Module is required'
  if (!draft.preconditions.trim()) errors.preconditions = 'Preconditions are required'
  if (!draft.test_data.trim()) errors.test_data = 'Test data is required'
  if (!draft.expected_result.trim()) errors.expected_result = 'Expected result is required'
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

/** What the full form starts with when "More options" is chosen (nothing entered is lost). */
export function draftToPrefill(draft: QuickDraft): Partial<TestCaseFormValues> {
  const steps: BuilderStep[] | undefined = draft.steps.some((s) => s.action || s.expected)
    ? draft.steps.map((s) => newStep({ action: s.action, expected: s.expected }))
    : undefined
  return {
    title: draft.title,
    priority: draft.priority,
    module_id: draft.module_id,
    preconditions: draft.preconditions,
    test_data: draft.test_data,
    expected_result: draft.expected_result,
    ...(steps ? { steps } : {}),
  }
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
