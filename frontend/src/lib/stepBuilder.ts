// Pure helpers behind the reusable Dynamic Step Builder (components/StepBuilder.tsx).
// Test case steps and (later) defect reproduction steps share them; the component's
// `fields` prop picks the field set. Step numbers are never stored on a row: they
// are the row's position, so add / remove / reorder renumber automatically and the
// sequence a user sees is always the sequence that is saved.

export const MAX_STEPS = 200

export interface BuilderStep {
  /** Client-only stable identity (React key, drag source); never sent to the API. */
  key: string
  action: string
  test_data: string
  expected: string
  /** Defect repro steps: the step that failed when the defect was raised from an execution. */
  failed?: boolean
}

/** Which inputs a step row offers, and which of them must be filled. */
export interface StepFieldSet {
  actionLabel: string
  actionPlaceholder: string
  testData: boolean
  expected: boolean
  expectedRequired: boolean
  /** Fewest rows the builder allows (the last row cannot be removed below this). */
  minSteps: number
  /** At least one filled step is mandatory (shown with the required marker). */
  stepsRequired: boolean
}

export type StepFieldSetName = 'testcase' | 'defect'

export const STEP_FIELD_SETS: Record<StepFieldSetName, StepFieldSet> = {
  testcase: {
    actionLabel: 'Action',
    actionPlaceholder: 'What the tester does',
    testData: true,
    expected: true,
    expectedRequired: true,
    minSteps: 1,
    stepsRequired: true,
  },
  // Defect reproduction steps: just what to do, optionally what should have happened.
  defect: {
    actionLabel: 'Step',
    actionPlaceholder: 'What you did',
    testData: false,
    expected: true,
    expectedRequired: false,
    minSteps: 0,
    stepsRequired: true,
  },
}

let counter = 0
export function newStepKey(): string {
  counter += 1
  return `step-${Date.now().toString(36)}-${counter}`
}

export function newStep(partial: Partial<Omit<BuilderStep, 'key'>> = {}): BuilderStep {
  return { key: newStepKey(), action: '', test_data: '', expected: '', ...partial }
}

/** Rows from API steps (or nothing: one empty row, the starting state of a new case). */
export function stepsFromApi(
  steps: { action: string; expected: string; test_data?: string | null; failed?: boolean }[] | undefined,
): BuilderStep[] {
  if (!steps || steps.length === 0) return [newStep()]
  return steps.map((s) =>
    newStep({ action: s.action, expected: s.expected, test_data: s.test_data ?? '', ...(s.failed ? { failed: true } : {}) }),
  )
}

/** 1-based number shown for a row. */
export function stepNumber(index: number): number {
  return index + 1
}

/** Appends a row (at `afterIndex + 1`, or at the end). No-op at the maximum. */
export function addStep(steps: BuilderStep[], afterIndex?: number, max = MAX_STEPS): BuilderStep[] {
  if (steps.length >= max) return steps
  const at = afterIndex === undefined ? steps.length : afterIndex + 1
  return [...steps.slice(0, at), newStep(), ...steps.slice(at)]
}

export interface RemoveResult {
  steps: BuilderStep[]
  removed: BuilderStep | null
  index: number
}

/** Removes a row but never goes below `min` rows (then nothing is removed). */
export function removeStep(steps: BuilderStep[], index: number, min = 1): RemoveResult {
  if (index < 0 || index >= steps.length || steps.length <= min) return { steps, removed: null, index }
  return { steps: steps.filter((_, i) => i !== index), removed: steps[index], index }
}

/** Puts a removed row back where it was (the Undo of a removal). */
export function restoreStep(steps: BuilderStep[], removed: BuilderStep, index: number, max = MAX_STEPS): BuilderStep[] {
  if (steps.length >= max || steps.some((s) => s.key === removed.key)) return steps
  const at = Math.min(Math.max(index, 0), steps.length)
  return [...steps.slice(0, at), removed, ...steps.slice(at)]
}

/** Moves a row from one position to another (clamped); everything else keeps its order. */
export function moveStep(steps: BuilderStep[], from: number, to: number): BuilderStep[] {
  const target = Math.min(Math.max(to, 0), steps.length - 1)
  if (from < 0 || from >= steps.length || from === target) return steps
  const next = [...steps]
  const [item] = next.splice(from, 1)
  next.splice(target, 0, item)
  return next
}

export function updateStep(steps: BuilderStep[], index: number, patch: Partial<Omit<BuilderStep, 'key'>>): BuilderStep[] {
  return steps.map((s, i) => (i === index ? { ...s, ...patch } : s))
}

/** Lines of a pasted block, trimmed, blanks dropped; a leading "1." / "2)" / "- " marker is removed. */
export function parsePastedLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*(?:\d+[.)]|[-*])\s+/, '').trim())
    .filter(Boolean)
}

/**
 * Pasting several lines into a step's Action creates one step per line. The first
 * line fills the current row when its action is empty, otherwise every line becomes
 * a new row after it. Stops at the maximum. Returns null for a single line (a normal
 * paste, left to the browser).
 */
export function pasteLines(steps: BuilderStep[], index: number, text: string, max = MAX_STEPS): BuilderStep[] | null {
  const lines = parsePastedLines(text)
  if (lines.length < 2) return null
  const current = steps[index]
  const fillCurrent = current && !current.action.trim()
  const next = [...steps]
  let at = index
  lines.forEach((line, i) => {
    if (i === 0 && fillCurrent) {
      next[index] = { ...current, action: line }
      return
    }
    if (next.length >= max) return
    at += 1
    next.splice(at, 0, newStep({ action: line }))
  })
  return next
}

export interface StepErrors {
  action?: string
  expected?: string
}

/** Per-row errors, `[]`-indexed like `steps`; rows with no problem are `{}`. */
export function validateSteps(steps: BuilderStep[], fields: StepFieldSet = STEP_FIELD_SETS.testcase): StepErrors[] {
  return steps.map((s) => {
    const errors: StepErrors = {}
    const hasAnything = s.action.trim() || s.expected.trim() || s.test_data.trim()
    // A defect step row that was never touched is just ignored on save.
    if (fields.minSteps === 0 && !hasAnything) return errors
    if (!s.action.trim()) errors.action = `${fields.actionLabel} is required`
    if (fields.expected && fields.expectedRequired && !s.expected.trim()) errors.expected = 'Expected result is required'
    return errors
  })
}

export function stepsHaveErrors(errors: StepErrors[]): boolean {
  return errors.some((e) => e.action || e.expected)
}

/** Rows as the API wants them (trimmed; empty optional test data left out). */
export function stepsToApi(steps: BuilderStep[]): { action: string; expected: string; test_data?: string }[] {
  return steps
    .filter((s) => s.action.trim() || s.expected.trim() || s.test_data.trim())
    .map((s) => {
      const out: { action: string; expected: string; test_data?: string } = {
        action: s.action.trim(),
        expected: s.expected.trim(),
      }
      if (s.test_data.trim()) out.test_data = s.test_data.trim()
      return out
    })
}

/** True when two row lists hold the same content in the same order (keys ignored). */
export function sameSteps(a: BuilderStep[], b: BuilderStep[]): boolean {
  if (a.length !== b.length) return false
  return a.every(
    (s, i) => s.action === b[i].action && s.expected === b[i].expected && s.test_data === b[i].test_data,
  )
}

/** Maps the API's `steps.<n>.<field>` error keys (field names `expected_result` included) onto rows. */
export function mapStepServerErrors(fields: Record<string, string> | undefined): Record<number, StepErrors> {
  const out: Record<number, StepErrors> = {}
  for (const [key, message] of Object.entries(fields ?? {})) {
    const m = /^steps\.(\d+)\.(action|expected|expected_result)$/.exec(key)
    if (!m) continue
    const index = Number(m[1])
    const field = m[2] === 'action' ? 'action' : 'expected'
    out[index] = { ...out[index], [field]: message }
  }
  return out
}
