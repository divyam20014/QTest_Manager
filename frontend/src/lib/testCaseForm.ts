// Pure logic of the Test Case create / edit form (ADR-115 / ADR-116): the value
// model, the client-side rules (mirroring the API's mandatory-on-create fields),
// mapping the API's per-field errors (`error.fields`) back onto the form, and
// building the create / PATCH bodies.
import type { TestCase, TestCaseCreateRequest, TestCaseUpdateRequest, AutomationStatus } from '@/api/testCases'
import { sameSteps, stepsFromApi, stepsToApi, validateSteps, stepsHaveErrors, type BuilderStep } from '@/lib/stepBuilder'

export const TITLE_MIN = 5
export const TITLE_MAX = 255

export interface TestCaseFormValues {
  requirement_ref: string
  /** The deepest module / sub-module / feature chosen. */
  module_id: string
  title: string
  description: string
  test_type: string
  priority: string
  severity: string
  automation_status: AutomationStatus
  environment: string
  preconditions: string
  test_data: string
  /** Reject invalid JSON in Test Data (sends test_data_format=json). */
  test_data_json: boolean
  steps: BuilderStep[]
  expected_result: string
  postconditions: string
  assignee_id: string
  scenario_id: string
  scenario_description: string
}

export type FormFieldKey = Exclude<keyof TestCaseFormValues, 'steps' | 'test_data_json'> | 'steps'
export type FormErrors = Partial<Record<FormFieldKey, string>>

/** Which of the six form sections each field lives in (for error badges / auto-expand). */
export const SECTION_OF: Record<FormFieldKey, number> = {
  requirement_ref: 1,
  module_id: 1,
  title: 1,
  description: 1,
  test_type: 2,
  priority: 2,
  severity: 2,
  automation_status: 2,
  environment: 2,
  preconditions: 3,
  test_data: 3,
  steps: 4,
  expected_result: 4,
  postconditions: 4,
  assignee_id: 6,
  scenario_id: 6,
  scenario_description: 6,
}

export const SECTION_TITLES: Record<number, string> = {
  1: 'Basic Information',
  2: 'Classification',
  3: 'Test Preparation',
  4: 'Test Execution Instructions',
  5: 'Execution Details',
  6: 'Additional Information',
}

export function emptyFormValues(over: Partial<TestCaseFormValues> = {}): TestCaseFormValues {
  return {
    requirement_ref: '',
    module_id: '',
    title: '',
    description: '',
    test_type: '',
    priority: '',
    severity: '',
    automation_status: 'Manual',
    environment: '',
    preconditions: '',
    test_data: '',
    test_data_json: false,
    steps: stepsFromApi(undefined),
    expected_result: '',
    postconditions: '',
    assignee_id: '',
    scenario_id: '',
    scenario_description: '',
    ...over,
  }
}

export function valuesFromTestCase(tc: TestCase): TestCaseFormValues {
  return emptyFormValues({
    requirement_ref: tc.requirement_ref ?? '',
    module_id: tc.module_id ?? '',
    title: tc.title,
    description: tc.description ?? '',
    test_type: tc.test_type ?? '',
    priority: tc.priority,
    severity: tc.severity ?? '',
    automation_status: tc.automation_status ?? 'Manual',
    environment: tc.environment ?? '',
    preconditions: tc.preconditions ?? tc.prerequisite ?? '',
    test_data: tc.test_data ?? '',
    test_data_json: false,
    steps: stepsFromApi(tc.steps),
    expected_result: tc.expected_result ?? '',
    postconditions: tc.postconditions ?? '',
    assignee_id: tc.assignee_id ?? '',
    scenario_id: tc.scenario_id ?? '',
    scenario_description: tc.scenario_description ?? '',
  })
}

/** Returns an error message when `text` is not valid JSON, else null. */
export function jsonProblem(text: string): string | null {
  if (!text.trim()) return null
  try {
    JSON.parse(text)
    return null
  } catch (e) {
    return e instanceof Error ? e.message : 'Not valid JSON'
  }
}

export function looksLikeJson(text: string): boolean {
  const t = text.trim()
  return t.startsWith('{') || t.startsWith('[')
}

/** Re-indents JSON text; returns null when it is not valid JSON. */
export function prettyJson(text: string): string | null {
  try {
    return JSON.stringify(JSON.parse(text), null, 2)
  } catch {
    return null
  }
}

export interface ValidateOptions {
  /** On edit: the values the form started with. A mandatory field the case never had stays optional. */
  initial?: TestCaseFormValues
}

const REQUIRED: { key: Exclude<FormFieldKey, 'steps'>; message: string }[] = [
  { key: 'module_id', message: 'Module is required' },
  { key: 'priority', message: 'Priority is required' },
  { key: 'preconditions', message: 'Preconditions are required' },
  { key: 'test_data', message: 'Test data is required' },
  { key: 'expected_result', message: 'Expected result is required' },
]

/** Validates one field (used on blur); `undefined` means fine. */
export function validateField(
  key: FormFieldKey,
  values: TestCaseFormValues,
  options: ValidateOptions = {},
): string | undefined {
  if (key === 'title') {
    const t = values.title.trim()
    if (!t) return 'Title is required'
    if (t.length < TITLE_MIN) return `Title needs at least ${TITLE_MIN} characters`
    if (t.length > TITLE_MAX) return `Title can be at most ${TITLE_MAX} characters`
    return undefined
  }
  if (key === 'steps') {
    const rows = stepsToApi(values.steps)
    if (rows.length === 0) return 'Add at least one step'
    if (stepsHaveErrors(validateSteps(values.steps))) return 'Every step needs an action and an expected result'
    return undefined
  }
  if (key === 'test_data' && values.test_data_json) {
    const problem = jsonProblem(values.test_data)
    if (problem && values.test_data.trim()) return `Test data is not valid JSON: ${problem}`
  }
  const rule = REQUIRED.find((r) => r.key === key)
  if (rule) {
    const value = String(values[rule.key] ?? '').trim()
    if (value) return undefined
    // Editing: a legacy case that never had this field is not refused for leaving it empty.
    if (options.initial && !String(options.initial[rule.key] ?? '').trim()) return undefined
    return rule.message
  }
  return undefined
}

const ALL_KEYS: FormFieldKey[] = [
  'title',
  'module_id',
  'priority',
  'preconditions',
  'test_data',
  'steps',
  'expected_result',
]

export function validateForm(values: TestCaseFormValues, options: ValidateOptions = {}): FormErrors {
  const errors: FormErrors = {}
  for (const key of ALL_KEYS) {
    const message = validateField(key, values, options)
    if (message) errors[key] = message
  }
  return errors
}

/** `error.fields` from the API onto the form's fields / step rows. Unknown keys come back in `other`. */
export function mapServerFields(fields: Record<string, string> | undefined): {
  errors: FormErrors
  other: string[]
} {
  const errors: FormErrors = {}
  const other: string[] = []
  const alias: Record<string, string> = { prerequisite: 'preconditions' }
  for (const [rawKey, message] of Object.entries(fields ?? {})) {
    const key: string = alias[rawKey] ?? rawKey
    if (/^steps(\.|$)/.test(key)) {
      errors.steps = errors.steps ? errors.steps : message
    } else if (key in SECTION_OF) {
      errors[key as FormFieldKey] = message
    } else if (key === 'test_data_format') {
      errors.test_data = message
    } else {
      other.push(`${key}: ${message}`)
    }
  }
  return { errors, other }
}

export function sectionsWithErrors(errors: FormErrors): number[] {
  const out = new Set<number>()
  for (const key of Object.keys(errors) as FormFieldKey[]) if (errors[key]) out.add(SECTION_OF[key])
  return [...out].sort()
}

function nullable(value: string): string | null {
  const t = value.trim()
  return t ? t : null
}

/** The create request: everything the API accepts, blanks sent as null. */
export function toCreateRequest(values: TestCaseFormValues): TestCaseCreateRequest {
  return {
    title: values.title.trim(),
    module_id: values.module_id || null,
    description: values.description.trim(),
    priority: values.priority,
    assignee_id: values.assignee_id || null,
    steps: stepsToApi(values.steps),
    preconditions: nullable(values.preconditions),
    test_data: nullable(values.test_data),
    test_data_format: values.test_data_json ? 'json' : 'auto',
    expected_result: nullable(values.expected_result),
    postconditions: nullable(values.postconditions),
    test_type: nullable(values.test_type),
    severity: nullable(values.severity),
    automation_status: values.automation_status,
    environment: nullable(values.environment),
    requirement_ref: nullable(values.requirement_ref),
    scenario_id: nullable(values.scenario_id),
    scenario_description: nullable(values.scenario_description),
  }
}

/** The PATCH body: only the fields that changed, so a metadata-only edit stays metadata-only. */
export function toUpdateRequest(values: TestCaseFormValues, initial: TestCaseFormValues): TestCaseUpdateRequest {
  const full = toCreateRequest(values)
  const base = toCreateRequest(initial)
  const out: Record<string, unknown> = {}
  for (const key of Object.keys(full) as (keyof TestCaseCreateRequest)[]) {
    if (key === 'test_data_format') continue
    if (key === 'steps') {
      if (!sameSteps(values.steps, initial.steps)) out.steps = full.steps
      continue
    }
    if (full[key] !== base[key]) out[key] = full[key]
  }
  if (out.test_data !== undefined && values.test_data_json) out.test_data_format = 'json'
  return out as TestCaseUpdateRequest
}

/** Anything changed? (drives the dirty-form guard) */
export function isDirty(values: TestCaseFormValues, initial: TestCaseFormValues): boolean {
  return Object.keys(toUpdateRequest(values, initial)).length > 0
}

// ---- module tree (Module / Submodule / Feature) ---------------------------

export interface ModuleNode {
  id: string
  name: string
  parent_id: string | null
}

/** Ids from the top-level module down to `moduleId` (its ancestors first). */
export function modulePathIds(modules: ModuleNode[], moduleId: string): string[] {
  const byId = new Map(modules.map((m) => [m.id, m]))
  const path: string[] = []
  let current = byId.get(moduleId)
  const seen = new Set<string>()
  while (current && !seen.has(current.id)) {
    seen.add(current.id)
    path.unshift(current.id)
    current = current.parent_id ? byId.get(current.parent_id) : undefined
  }
  return path
}

export function childModules(modules: ModuleNode[], parentId: string | null): ModuleNode[] {
  return modules.filter((m) => (m.parent_id ?? null) === parentId).sort((a, b) => a.name.localeCompare(b.name))
}

/** Level names for the cascading selects. */
export const MODULE_LEVELS = ['Module', 'Sub-module', 'Feature'] as const
