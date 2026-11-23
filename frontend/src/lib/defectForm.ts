// Pure logic of the Defect create / edit form (ADR-118 / ADR-119): the value model, the
// client-side rules (mirroring the API's mandatory-on-create fields), mapping the API's per-field
// errors (`error.fields`) back onto the form, and building the create / PATCH / status bodies.
// Shared by the full-page form and the quick-create dialog of the Execution Console.
import type {
  Defect,
  DefectCreateRequest,
  DefectDraft,
  DefectStatus,
  DefectUpdateRequest,
  ReproStep,
  Resolution,
  RootCause,
} from '@/api/defects'
import { planTransition, resolutionRule } from '@/lib/defectWorkflow'
import { tagProblem } from '@/lib/tags'
import {
  STEP_FIELD_SETS,
  sameSteps,
  stepsFromApi,
  stepsHaveErrors,
  validateSteps,
  type BuilderStep,
} from '@/lib/stepBuilder'

export const TITLE_MIN = 5
export const TITLE_MAX = 255
export const DESCRIPTION_MAX = 20000
export const TEXT_MAX = 10000
export const SHORT_MAX = 200
export const MAX_LABELS = 20
export const LABEL_MAX = 40

export interface DefectFormValues {
  /** Create only (a defect never changes project). */
  project_id: string
  title: string
  description: string
  module_id: string
  preconditions: string
  steps: BuilderStep[]
  expected_result: string
  actual_result: string
  environment: string
  build_found: string
  severity: string
  priority: string
  status: string
  resolution: string
  root_cause: RootCause | ''
  root_cause_notes: string
  assigned_to: string
  fix_version: string
  /** Linked test case ids (the picker's chips). */
  test_case_ids: string[]
  labels: string[]
}

export type FormFieldKey = keyof DefectFormValues
export type FormErrors = Partial<Record<FormFieldKey, string>>

/** Which of the six form sections each field lives in (for error badges / auto-expand). */
export const SECTION_OF: Record<FormFieldKey, number> = {
  project_id: 1,
  title: 1,
  description: 1,
  module_id: 1,
  preconditions: 2,
  steps: 2,
  expected_result: 2,
  actual_result: 2,
  environment: 3,
  build_found: 3,
  severity: 4,
  priority: 4,
  status: 4,
  resolution: 4,
  root_cause: 5,
  root_cause_notes: 5,
  assigned_to: 5,
  fix_version: 5,
  test_case_ids: 6,
  labels: 6,
}

export const SECTION_TITLES: Record<number, string> = {
  1: 'Bug Overview',
  2: 'Reproduction Details',
  3: 'Environment & Evidence',
  4: 'Classification',
  5: 'Ownership & Tracking',
  6: 'Traceability',
}

export function emptyFormValues(over: Partial<DefectFormValues> = {}): DefectFormValues {
  return {
    project_id: '',
    title: '',
    description: '',
    module_id: '',
    preconditions: '',
    steps: stepsFromApi(undefined),
    expected_result: '',
    actual_result: '',
    environment: '',
    build_found: '',
    severity: '',
    priority: '',
    status: 'New',
    resolution: '',
    root_cause: '',
    root_cause_notes: '',
    assigned_to: '',
    fix_version: '',
    test_case_ids: [],
    labels: [],
    ...over,
  }
}

/** The steps of a defect as builder rows (legacy rows read back with steps derived from their text). */
export function stepsFromDefect(steps: ReproStep[] | null | undefined): BuilderStep[] {
  return stepsFromApi(
    steps?.map((s) => ({ action: s.action, expected: s.expected_result ?? '', test_data: s.test_data, failed: s.failed })),
  )
}

export function valuesFromDefect(d: Defect): DefectFormValues {
  return emptyFormValues({
    project_id: d.project_id,
    title: d.title,
    description: d.description ?? '',
    module_id: d.module_id ?? '',
    preconditions: d.preconditions ?? '',
    steps: stepsFromDefect(d.repro_steps),
    expected_result: d.expected_result ?? '',
    actual_result: d.actual_result ?? '',
    environment: d.environment ?? d.environment_name ?? '',
    build_found: d.build_found ?? '',
    severity: d.severity,
    priority: d.priority,
    status: d.status,
    resolution: d.resolution ?? '',
    root_cause: d.root_cause ?? '',
    root_cause_notes: d.root_cause_notes ?? '',
    assigned_to: d.assigned_to ?? '',
    fix_version: d.fix_version ?? '',
    test_case_ids: d.linked_test_cases.map((t) => t.id),
    labels: d.labels ?? [],
  })
}

/** The form values for a defect raised from a failed execution (`GET /test-run-cases/{id}/defect-draft`). */
export function valuesFromDraft(draft: DefectDraft, over: Partial<DefectFormValues> = {}): DefectFormValues {
  return emptyFormValues({
    project_id: draft.project_id,
    title: draft.title,
    description: draft.description ?? '',
    module_id: draft.module_id ?? '',
    preconditions: draft.preconditions ?? '',
    steps: stepsFromApi(
      draft.repro_steps.map((s) => ({
        action: s.action,
        expected: s.expected_result ?? '',
        test_data: s.test_data,
        failed: s.failed,
      })),
    ),
    expected_result: draft.expected_result ?? '',
    actual_result: draft.actual_result ?? '',
    environment: draft.environment ?? '',
    build_found: draft.build_found ?? '',
    test_case_ids: [draft.test_case_id],
    ...over,
  })
}

export interface ValidateOptions {
  /** On edit: the values the form started with. A mandatory field the defect never had stays optional. */
  initial?: DefectFormValues
  /** Create only: the project must be chosen. */
  needsProject?: boolean
}

type TextKey = 'description' | 'expected_result' | 'actual_result' | 'environment' | 'severity' | 'priority'
const REQUIRED: { key: TextKey; message: string }[] = [
  { key: 'description', message: 'Description is required' },
  { key: 'expected_result', message: 'Expected result is required' },
  { key: 'actual_result', message: 'Actual result is required' },
  { key: 'environment', message: 'Environment is required' },
  { key: 'severity', message: 'Severity is required' },
  { key: 'priority', message: 'Priority is required' },
]

const LIMITS: { key: FormFieldKey; max: number; label: string }[] = [
  { key: 'description', max: DESCRIPTION_MAX, label: 'Description' },
  { key: 'preconditions', max: TEXT_MAX, label: 'Preconditions' },
  { key: 'expected_result', max: TEXT_MAX, label: 'Expected result' },
  { key: 'actual_result', max: TEXT_MAX, label: 'Actual result' },
  { key: 'root_cause_notes', max: TEXT_MAX, label: 'Root cause notes' },
  { key: 'environment', max: SHORT_MAX, label: 'Environment' },
  { key: 'build_found', max: SHORT_MAX, label: 'Build / version' },
  { key: 'fix_version', max: SHORT_MAX, label: 'Fix version' },
]

/** Why a label cannot be added (null when it can); used by the tag input and the validation. */
export function labelProblem(label: string, existing: string[]): string | null {
  return tagProblem(label, existing, { max: MAX_LABELS, maxLength: LABEL_MAX })
}

/** Validates one field (used on blur); `undefined` means fine. */
export function validateField(key: FormFieldKey, values: DefectFormValues, options: ValidateOptions = {}): string | undefined {
  if (key === 'project_id') return options.needsProject && !values.project_id ? 'Project is required' : undefined
  if (key === 'title') {
    const t = values.title.trim()
    if (!t) return 'Title is required'
    if (t.length < TITLE_MIN) return `Title needs at least ${TITLE_MIN} characters`
    if (t.length > TITLE_MAX) return `Title can be at most ${TITLE_MAX} characters`
    return undefined
  }
  if (key === 'steps') {
    const filled = values.steps.filter((s) => s.action.trim() || s.expected.trim() || s.test_data.trim())
    if (filled.length === 0) {
      if (options.initial && options.initial.steps.every((s) => !s.action.trim())) return undefined
      return 'Add at least one step to reproduce'
    }
    if (stepsHaveErrors(validateSteps(values.steps, STEP_FIELD_SETS.defect))) return 'Every step needs a description'
    return undefined
  }
  if (key === 'labels') {
    if (values.labels.length > MAX_LABELS) return `A defect can have at most ${MAX_LABELS} labels`
    const long = values.labels.find((l) => l.length > LABEL_MAX)
    return long ? `A label can be at most ${LABEL_MAX} characters` : undefined
  }
  if (key === 'resolution') return resolutionProblem(values, options.initial)
  if (key === 'assigned_to') {
    return values.status === 'Assigned' && !values.assigned_to && (!options.initial || options.initial.status !== 'Assigned')
      ? 'Status Assigned needs an assignee'
      : undefined
  }
  const rule = REQUIRED.find((r) => r.key === key)
  if (rule) {
    const value = String(values[rule.key] ?? '').trim()
    if (!value) {
      // Editing: a legacy defect that never had this field is not refused for leaving it empty.
      if (options.initial && !String(options.initial[rule.key] ?? '').trim()) return undefined
      return rule.message
    }
  }
  const limit = LIMITS.find((l) => l.key === key)
  if (limit) {
    const text = String(values[limit.key as TextKey] ?? '')
    if (text.length > limit.max) return `${limit.label} can be at most ${limit.max.toLocaleString('en-US')} characters`
  }
  return undefined
}

/** The resolution problem for the chosen status (the dialog's inline explanation uses the same rules). */
export function resolutionProblem(values: DefectFormValues, initial?: DefectFormValues): string | undefined {
  const target = values.status
  const from = initial?.status ?? 'New'
  if (!initial || target !== initial.status) {
    const plan = planTransition(from, target as DefectStatus)
    if (plan.needsResolution && !values.resolution) return `Choose a resolution to set ${target}`
    if (values.resolution && !plan.resolutionOptions.includes(values.resolution as Resolution)) {
      return plan.resolutionOptions.length === 0
        ? `A resolution is not used for ${target}`
        : `Resolution "${values.resolution}" is not valid for ${target}`
    }
    return undefined
  }
  const rule = resolutionRule(target)
  if (values.resolution && !rule.allowed.includes(values.resolution as Resolution)) {
    return `Resolution "${values.resolution}" is not valid for ${target}`
  }
  return undefined
}

const ALL_KEYS: FormFieldKey[] = [
  'project_id',
  'title',
  'description',
  'steps',
  'expected_result',
  'actual_result',
  'environment',
  'severity',
  'priority',
  'preconditions',
  'build_found',
  'fix_version',
  'root_cause_notes',
  'labels',
  'resolution',
  'assigned_to',
]

export function validateForm(values: DefectFormValues, options: ValidateOptions = {}): FormErrors {
  const errors: FormErrors = {}
  for (const key of ALL_KEYS) {
    const message = validateField(key, values, options)
    if (message) errors[key] = message
  }
  return errors
}

/** `error.fields` from the API onto the form's fields / step rows. Unknown keys come back in `other`. */
export function mapServerFields(fields: Record<string, string> | undefined): { errors: FormErrors; other: string[] } {
  const errors: FormErrors = {}
  const other: string[] = []
  const alias: Record<string, FormFieldKey> = {
    repro_steps: 'steps',
    steps_to_reproduce: 'steps',
    environment_id: 'environment',
    assignee: 'assigned_to',
    module: 'module_id',
    severity: 'severity',
    test_case_id: 'test_case_ids',
  }
  for (const [rawKey, message] of Object.entries(fields ?? {})) {
    if (/^(repro_steps|steps)(\.|$)/.test(rawKey)) {
      errors.steps = errors.steps ?? message
      continue
    }
    if (/^labels(\.|$)/.test(rawKey)) {
      errors.labels = errors.labels ?? message
      continue
    }
    const key = alias[rawKey] ?? rawKey
    if (key in SECTION_OF) errors[key as FormFieldKey] = message
    else other.push(`${rawKey}: ${message}`)
  }
  return { errors, other }
}

/** Per-row step errors from the API's `repro_steps.<n>.<field>` keys. */
export function mapStepServerErrors(fields: Record<string, string> | undefined): Record<number, { action?: string; expected?: string }> {
  const out: Record<number, { action?: string; expected?: string }> = {}
  for (const [key, message] of Object.entries(fields ?? {})) {
    const m = /^repro_steps\.(\d+)\.(action|expected|expected_result)$/.exec(key)
    if (!m) continue
    const index = Number(m[1])
    const field = m[2] === 'action' ? 'action' : 'expected'
    out[index] = { ...out[index], [field]: message }
  }
  return out
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

/** Steps as the API wants them (`expected_result`, trimmed; untouched rows left out; the failed flag kept). */
export function stepsToRepro(steps: BuilderStep[]): ReproStep[] {
  return steps
    .filter((s) => s.action.trim() || s.expected.trim() || s.test_data.trim())
    .map((s) => {
      const out: ReproStep = { action: s.action.trim() }
      if (s.expected.trim()) out.expected_result = s.expected.trim()
      if (s.test_data.trim()) out.test_data = s.test_data.trim()
      if (s.failed) out.failed = true
      return out
    })
}

/** The create request: everything the API accepts, optional blanks left out. */
export function toCreateRequest(values: DefectFormValues, extra: Partial<DefectCreateRequest> = {}): DefectCreateRequest {
  const req: DefectCreateRequest = {
    project_id: values.project_id || undefined,
    title: values.title.trim(),
    description: values.description.trim(),
    repro_steps: stepsToRepro(values.steps),
    expected_result: values.expected_result.trim(),
    actual_result: values.actual_result.trim(),
    environment: values.environment.trim(),
    severity: values.severity,
    priority: values.priority,
  }
  const pre = nullable(values.preconditions)
  if (pre) req.preconditions = pre
  const build = nullable(values.build_found)
  if (build) req.build_found = build
  const fix = nullable(values.fix_version)
  if (fix) req.fix_version = fix
  if (values.module_id) req.module_id = values.module_id
  if (values.assigned_to) req.assigned_to = values.assigned_to
  if (values.root_cause) req.root_cause = values.root_cause
  const notes = nullable(values.root_cause_notes)
  if (notes) req.root_cause_notes = notes
  if (values.labels.length > 0) req.labels = values.labels
  if (values.test_case_ids.length > 0) req.test_case_ids = values.test_case_ids
  // A new defect is New, or Assigned when an assignee is chosen (the API refuses anything else).
  if (values.status === 'Assigned' && values.assigned_to) req.status = 'Assigned'
  return { ...req, ...extra }
}

function sameList(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i])
}

/** The PATCH body: only the fields that changed, so a one-field edit stays a one-field edit. */
export function toUpdateRequest(values: DefectFormValues, initial: DefectFormValues): DefectUpdateRequest {
  const out: DefectUpdateRequest = {}
  const text = (key: 'title' | 'description' | 'expected_result' | 'actual_result' | 'environment') => {
    if (values[key].trim() !== initial[key].trim()) out[key] = values[key].trim()
  }
  text('title')
  text('description')
  text('expected_result')
  text('actual_result')
  text('environment')
  const optional = (key: 'preconditions' | 'build_found' | 'fix_version' | 'root_cause_notes') => {
    if (values[key].trim() !== initial[key].trim()) out[key] = nullable(values[key])
  }
  optional('preconditions')
  optional('build_found')
  optional('fix_version')
  optional('root_cause_notes')
  if (values.severity !== initial.severity) out.severity = values.severity
  if (values.priority !== initial.priority) out.priority = values.priority
  if (values.module_id !== initial.module_id) out.module_id = values.module_id || null
  if (values.assigned_to !== initial.assigned_to) out.assigned_to = values.assigned_to || null
  if (values.root_cause !== initial.root_cause) out.root_cause = values.root_cause || null
  if (!sameList(values.labels, initial.labels)) out.labels = values.labels
  if (!sameSteps(values.steps, initial.steps)) out.repro_steps = stepsToRepro(values.steps)
  // A resolution edit without a status change (the status endpoint handles the changing case).
  if (values.status === initial.status && values.resolution !== initial.resolution) {
    out.resolution = (values.resolution || null) as Resolution | null
  }
  return out
}

/** The status move the form asks for (done through the status endpoint after the field edit), or null. */
export function statusChange(values: DefectFormValues, initial: DefectFormValues): { status: DefectStatus; resolution?: Resolution } | null {
  if (values.status === initial.status) return null
  return {
    status: values.status as DefectStatus,
    ...(values.resolution ? { resolution: values.resolution as Resolution } : {}),
  }
}

/** Test cases to link and unlink to reach the chosen set (applied after the field edit). */
export function linkDiff(values: DefectFormValues, initial: DefectFormValues): { add: string[]; remove: string[] } {
  return {
    add: values.test_case_ids.filter((id) => !initial.test_case_ids.includes(id)),
    remove: initial.test_case_ids.filter((id) => !values.test_case_ids.includes(id)),
  }
}

/** Anything changed? (drives the dirty-form guard) */
export function isDirty(values: DefectFormValues, initial: DefectFormValues): boolean {
  if (Object.keys(toUpdateRequest(values, initial)).length > 0) return true
  if (statusChange(values, initial)) return true
  const { add, remove } = linkDiff(values, initial)
  return add.length + remove.length > 0
}
