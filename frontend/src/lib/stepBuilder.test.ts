import { describe, expect, it } from 'vitest'

import {
  MAX_STEPS,
  STEP_FIELD_SETS,
  addStep,
  mapStepServerErrors,
  moveStep,
  newStep,
  parsePastedLines,
  pasteLines,
  removeStep,
  restoreStep,
  sameSteps,
  stepNumber,
  stepsFromApi,
  stepsHaveErrors,
  stepsToApi,
  updateStep,
  validateSteps,
} from './stepBuilder'

const rows = (...actions: string[]) => actions.map((action) => newStep({ action, expected: `${action}!` }))
const actions = (steps: { action: string }[]) => steps.map((s) => s.action)

describe('step builder', () => {
  it('starts with one empty row and numbers by position', () => {
    const steps = stepsFromApi(undefined)
    expect(steps).toHaveLength(1)
    expect(steps[0]).toMatchObject({ action: '', expected: '', test_data: '' })
    expect([0, 1, 4].map(stepNumber)).toEqual([1, 2, 5])
  })

  it('adds after a row or at the end, and stops at the maximum', () => {
    const steps = rows('a', 'b', 'c')
    expect(actions(addStep(steps, 0))).toEqual(['a', '', 'b', 'c'])
    expect(actions(addStep(steps))).toEqual(['a', 'b', 'c', ''])
    const full = Array.from({ length: MAX_STEPS }, () => newStep())
    expect(addStep(full)).toBe(full)
  })

  it('removes a row (renumbering follows from position) but never below the minimum', () => {
    const steps = rows('a', 'b', 'c')
    const result = removeStep(steps, 1)
    expect(actions(result.steps)).toEqual(['a', 'c'])
    expect(result.removed?.action).toBe('b')
    expect(result.index).toBe(1)
    const single = rows('only')
    expect(removeStep(single, 0).removed).toBeNull()
    expect(removeStep(single, 0, 0).steps).toHaveLength(0)
  })

  it('undo puts a removed row back where it was, once', () => {
    const steps = rows('a', 'b', 'c')
    const { steps: after, removed, index } = removeStep(steps, 1)
    const restored = restoreStep(after, removed!, index)
    expect(actions(restored)).toEqual(['a', 'b', 'c'])
    expect(restoreStep(restored, removed!, index)).toBe(restored)
  })

  it('moves rows up and down, clamped, keeping the content and identity', () => {
    const steps = rows('a', 'b', 'c')
    const up = moveStep(steps, 2, 1)
    expect(actions(up)).toEqual(['a', 'c', 'b'])
    expect(up[1].key).toBe(steps[2].key)
    expect(actions(moveStep(steps, 0, 2))).toEqual(['b', 'c', 'a'])
    expect(moveStep(steps, 0, -1)).toBe(steps)
    expect(moveStep(steps, 1, 1)).toBe(steps)
  })

  it('edits one row without disturbing the sequence', () => {
    const steps = rows('a', 'b')
    const next = updateStep(steps, 1, { action: 'B2' })
    expect(actions(next)).toEqual(['a', 'B2'])
    expect(next[0]).toBe(steps[0])
  })

  it('splits pasted text into steps, dropping blanks and list markers', () => {
    expect(parsePastedLines('1. Open page\n\n2) Click login\n- Enter name\r\nDone')).toEqual([
      'Open page',
      'Click login',
      'Enter name',
      'Done',
    ])
    const empty = [newStep()]
    const filled = pasteLines(empty, 0, 'one\ntwo\nthree')!
    expect(actions(filled)).toEqual(['one', 'two', 'three'])
    const kept = pasteLines(rows('x'), 0, 'one\ntwo')!
    expect(actions(kept)).toEqual(['x', 'one', 'two'])
    expect(pasteLines(empty, 0, 'just one line')).toBeNull()
  })

  it('validates each row: action always, expected result for test cases', () => {
    const steps = [newStep({ action: 'ok', expected: 'ok' }), newStep({ action: '', expected: 'x' }), newStep({ action: 'a' })]
    const errors = validateSteps(steps)
    expect(errors[0]).toEqual({})
    expect(errors[1].action).toBeTruthy()
    expect(errors[2].expected).toBeTruthy()
    expect(stepsHaveErrors(errors)).toBe(true)
    expect(stepsHaveErrors(validateSteps(rows('a')))).toBe(false)
  })

  it('defect field set: expected result optional, untouched rows ignored', () => {
    const set = STEP_FIELD_SETS.defect
    expect(validateSteps([newStep({ action: 'did a thing' })], set)).toEqual([{}])
    expect(validateSteps([newStep()], set)).toEqual([{}])
    expect(validateSteps([newStep({ expected: 'x' })], set)[0].action).toBeTruthy()
  })

  it('converts to the API shape, trimming and leaving out empty rows and empty test data', () => {
    const steps = [
      newStep({ action: ' a ', expected: ' b ', test_data: ' d ' }),
      newStep(),
      newStep({ action: 'c', expected: 'd' }),
    ]
    expect(stepsToApi(steps)).toEqual([
      { action: 'a', expected: 'b', test_data: 'd' },
      { action: 'c', expected: 'd' },
    ])
  })

  it('compares content ignoring client keys', () => {
    expect(sameSteps(rows('a', 'b'), rows('a', 'b'))).toBe(true)
    expect(sameSteps(rows('a', 'b'), rows('b', 'a'))).toBe(false)
    expect(sameSteps(rows('a'), rows('a', 'b'))).toBe(false)
  })

  it('maps the API per-step errors (expected_result included) onto rows', () => {
    expect(
      mapStepServerErrors({
        'steps.0.action': 'must not be empty',
        'steps.2.expected_result': 'too long',
        'steps.1.expected': 'must not be empty',
        title: 'ignored here',
      }),
    ).toEqual({ 0: { action: 'must not be empty' }, 1: { expected: 'must not be empty' }, 2: { expected: 'too long' } })
  })
})
