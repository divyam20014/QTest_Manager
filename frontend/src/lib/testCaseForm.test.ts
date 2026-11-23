import { describe, expect, it } from 'vitest'

import { newStep } from './stepBuilder'
import {
  SECTION_OF,
  childModules,
  emptyFormValues,
  isDirty,
  jsonProblem,
  mapServerFields,
  modulePathIds,
  prettyJson,
  sectionsWithErrors,
  toCreateRequest,
  toUpdateRequest,
  validateField,
  validateForm,
} from './testCaseForm'

const complete = () =>
  emptyFormValues({
    title: 'Login works',
    module_id: 'm1',
    priority: 'High',
    preconditions: 'User exists',
    test_data: 'user=a',
    expected_result: 'Signed in',
    steps: [newStep({ action: 'Open', expected: 'Opens' })],
  })

describe('test case form rules', () => {
  it('a complete form is valid', () => {
    expect(validateForm(complete())).toEqual({})
  })

  it('an empty form reports every field the API requires on create', () => {
    const errors = validateForm(emptyFormValues())
    expect(Object.keys(errors).sort()).toEqual(
      ['expected_result', 'module_id', 'preconditions', 'priority', 'steps', 'test_data', 'title'].sort(),
    )
  })

  it('title: required, 5 to 255 characters after trimming', () => {
    const v = complete()
    expect(validateField('title', { ...v, title: '   ' })).toBe('Title is required')
    expect(validateField('title', { ...v, title: 'abcd' })).toMatch(/at least 5/)
    expect(validateField('title', { ...v, title: 'a'.repeat(256) })).toMatch(/at most 255/)
    expect(validateField('title', { ...v, title: ' abcde ' })).toBeUndefined()
  })

  it('steps: at least one, each with an action and an expected result', () => {
    const v = complete()
    expect(validateField('steps', { ...v, steps: [newStep()] })).toBe('Add at least one step')
    expect(validateField('steps', { ...v, steps: [newStep({ action: 'a' })] })).toMatch(/expected result/)
  })

  it('JSON option rejects malformed test data; plain text is fine otherwise', () => {
    const v = { ...complete(), test_data: '{bad', test_data_json: true }
    expect(validateField('test_data', v)).toMatch(/not valid JSON/)
    expect(validateField('test_data', { ...v, test_data: '{"a":1}' })).toBeUndefined()
    expect(validateField('test_data', { ...v, test_data_json: false })).toBeUndefined()
    expect(jsonProblem('{"a":1}')).toBeNull()
    expect(jsonProblem('{nope')).toBeTruthy()
    expect(prettyJson('{"a":1}')).toBe('{\n  "a": 1\n}')
    expect(prettyJson('nope')).toBeNull()
  })

  it('editing: a legacy case that never had a mandatory field may keep it empty, but clearing one is an error', () => {
    const legacy = { ...complete(), preconditions: '' }
    expect(validateField('preconditions', legacy, { initial: legacy })).toBeUndefined()
    const had = complete()
    expect(validateField('preconditions', { ...had, preconditions: '' }, { initial: had })).toBe('Preconditions are required')
  })

  it('maps the API per-field errors onto the form, step rows onto the steps section', () => {
    const { errors, other } = mapServerFields({
      module_id: 'Module is required',
      prerequisite: 'Preconditions are required',
      expected_result: 'Expected result is required',
      'steps.1.action': 'must not be empty',
      test_data_format: 'test_data is not valid JSON',
      surprise: 'unexpected',
    })
    expect(errors.module_id).toBe('Module is required')
    expect(errors.preconditions).toBe('Preconditions are required')
    expect(errors.expected_result).toBe('Expected result is required')
    expect(errors.steps).toBe('must not be empty')
    expect(errors.test_data).toMatch(/not valid JSON/)
    expect(other).toEqual(['surprise: unexpected'])
  })

  it('knows which of the six sections a field lives in (for error badges)', () => {
    expect(SECTION_OF.title).toBe(1)
    expect(SECTION_OF.priority).toBe(2)
    expect(SECTION_OF.preconditions).toBe(3)
    expect(SECTION_OF.expected_result).toBe(4)
    expect(sectionsWithErrors({ module_id: 'x', expected_result: 'y', priority: 'z' })).toEqual([1, 2, 4])
  })

  it('builds the create request with blanks as null and the JSON hint', () => {
    const req = toCreateRequest({ ...complete(), severity: '', test_data_json: true, description: '  ' })
    expect(req).toMatchObject({
      title: 'Login works',
      module_id: 'm1',
      priority: 'High',
      preconditions: 'User exists',
      test_data: 'user=a',
      test_data_format: 'json',
      expected_result: 'Signed in',
      severity: null,
      automation_status: 'Manual',
      description: '',
    })
    expect(req.steps).toEqual([{ action: 'Open', expected: 'Opens' }])
  })

  it('PATCH carries only what changed, so a metadata edit stays a metadata edit', () => {
    const initial = complete()
    expect(toUpdateRequest(initial, initial)).toEqual({})
    expect(isDirty(initial, initial)).toBe(false)
    const changed = { ...initial, severity: 'Major', steps: initial.steps.map((s) => ({ ...s })) }
    expect(toUpdateRequest(changed, initial)).toEqual({ severity: 'Major' })
    const edited = { ...initial, steps: [newStep({ action: 'Open', expected: 'Different' })] }
    expect(Object.keys(toUpdateRequest(edited, initial))).toEqual(['steps'])
    expect(isDirty(edited, initial)).toBe(true)
  })

  it('module hierarchy: path from the top module down, children sorted by name', () => {
    const modules = [
      { id: 'a', name: 'Claims', parent_id: null },
      { id: 'b', name: 'Intake', parent_id: 'a' },
      { id: 'c', name: 'Form', parent_id: 'b' },
      { id: 'd', name: 'Adjudication', parent_id: 'a' },
    ]
    expect(modulePathIds(modules, 'c')).toEqual(['a', 'b', 'c'])
    expect(modulePathIds(modules, 'zzz')).toEqual([])
    expect(childModules(modules, 'a').map((m) => m.id)).toEqual(['d', 'b'])
    expect(childModules(modules, null).map((m) => m.id)).toEqual(['a'])
  })
})
