import { describe, expect, it } from 'vitest'

import type { Defect, DefectDraft } from '@/api/defects'
import {
  emptyFormValues,
  isDirty,
  linkDiff,
  mapServerFields,
  mapStepServerErrors,
  sectionsWithErrors,
  statusChange,
  stepsToRepro,
  toCreateRequest,
  toUpdateRequest,
  validateField,
  validateForm,
  valuesFromDefect,
  valuesFromDraft,
  type DefectFormValues,
} from './defectForm'
import { newStep } from './stepBuilder'

function valid(over: Partial<DefectFormValues> = {}): DefectFormValues {
  return emptyFormValues({
    project_id: 'p1',
    title: 'Checkout fails',
    description: 'The checkout page errors out',
    steps: [newStep({ action: 'Open checkout' })],
    expected_result: 'Order is placed',
    actual_result: 'A 500 error',
    environment: 'Staging',
    severity: 'High',
    priority: 'Medium',
    ...over,
  })
}

describe('defect form validation (mirrors the API mandatory fields)', () => {
  it('flags every mandatory field of an empty form at once', () => {
    const errors = validateForm(emptyFormValues(), { needsProject: true })
    expect(Object.keys(errors).sort()).toEqual(
      ['actual_result', 'description', 'environment', 'expected_result', 'priority', 'project_id', 'severity', 'steps', 'title'].sort(),
    )
  })

  it('accepts a complete form', () => {
    expect(validateForm(valid(), { needsProject: true })).toEqual({})
  })

  it('title needs 5 to 255 characters', () => {
    expect(validateField('title', valid({ title: 'abc' }))).toMatch(/at least 5/)
    expect(validateField('title', valid({ title: 'x'.repeat(256) }))).toMatch(/at most 255/)
    expect(validateField('title', valid({ title: '  Valid title  ' }))).toBeUndefined()
  })

  it('needs at least one filled step, and every filled step needs a description', () => {
    expect(validateField('steps', valid({ steps: [newStep()] }))).toMatch(/at least one step/i)
    expect(validateField('steps', valid({ steps: [newStep({ expected: 'only expected' })] }))).toMatch(/needs a description/i)
    // The expected result of a step is optional for a defect.
    expect(validateField('steps', valid({ steps: [newStep({ action: 'do it' })] }))).toBeUndefined()
  })

  it('an edit does not refuse a legacy value the defect never had', () => {
    const initial = valid({ environment: '' })
    expect(validateField('environment', valid({ environment: '' }), { initial })).toBeUndefined()
    // ... but blanking a value it did have is refused.
    expect(validateField('environment', valid({ environment: '' }), { initial: valid() })).toMatch(/required/)
  })

  it('limits the text fields', () => {
    expect(validateField('environment', valid({ environment: 'x'.repeat(201) }))).toMatch(/at most 200/)
    expect(validateField('description', valid({ description: 'x'.repeat(20001) }))).toMatch(/at most 20,000/)
  })

  it('Assigned needs an assignee', () => {
    expect(validateField('assigned_to', valid({ status: 'Assigned', assigned_to: '' }))).toMatch(/needs an assignee/)
    expect(validateField('assigned_to', valid({ status: 'Assigned', assigned_to: 'u1' }))).toBeUndefined()
  })

  it('labels: at most 20 of 40 characters', () => {
    expect(validateField('labels', valid({ labels: Array.from({ length: 21 }, (_, i) => `l${i}`) }))).toMatch(/at most 20/)
    expect(validateField('labels', valid({ labels: ['x'.repeat(41)] }))).toMatch(/at most 40/)
    expect(validateField('labels', valid({ labels: ['ok'] }))).toBeUndefined()
  })
})

describe('mapping the API per-field errors back onto the form', () => {
  it('maps field names, the repro steps and the label list', () => {
    const { errors, other } = mapServerFields({
      title: 'Title is required',
      repro_steps: 'At least one step to reproduce is required',
      environment: 'Environment is required',
      assigned_to: 'assigned_to must be a member of this defect\'s project',
      'labels.2': 'too long',
      mystery: 'huh',
    })
    expect(errors.title).toBe('Title is required')
    expect(errors.steps).toMatch(/at least one step/i)
    expect(errors.environment).toBeTruthy()
    expect(errors.assigned_to).toMatch(/member/)
    expect(errors.labels).toBe('too long')
    expect(other).toEqual(['mystery: huh'])
  })

  it('maps a step row error onto its row', () => {
    expect(mapStepServerErrors({ 'repro_steps.1.action': 'Step action must not be blank', 'repro_steps.0.expected_result': 'too long' })).toEqual({
      1: { action: 'Step action must not be blank' },
      0: { expected: 'too long' },
    })
  })

  it('names the sections that hold failing fields (so they open)', () => {
    expect(sectionsWithErrors({ title: 'x', severity: 'y', labels: 'z', environment: 'e' })).toEqual([1, 3, 4, 6])
  })
})

describe('request bodies', () => {
  it('create: trims, sends repro_steps and leaves optional blanks out', () => {
    const req = toCreateRequest(valid({ title: ' Checkout fails ', labels: ['a'], test_case_ids: ['tc1'], build_found: '  ' }))
    expect(req.title).toBe('Checkout fails')
    expect(req.repro_steps).toEqual([{ action: 'Open checkout' }])
    expect(req.labels).toEqual(['a'])
    expect(req.test_case_ids).toEqual(['tc1'])
    expect('build_found' in req).toBe(false)
    expect('status' in req).toBe(false)
  })

  it('create: Assigned is only sent together with an assignee', () => {
    expect(toCreateRequest(valid({ status: 'Assigned', assigned_to: '' })).status).toBeUndefined()
    expect(toCreateRequest(valid({ status: 'Assigned', assigned_to: 'u1' })).status).toBe('Assigned')
  })

  it('steps keep the failed flag and drop untouched rows', () => {
    expect(stepsToRepro([newStep({ action: 'a', expected: 'b', failed: true }), newStep()])).toEqual([
      { action: 'a', expected_result: 'b', failed: true },
    ])
  })

  it('update: only the changed fields, so editing expected / actual stays a two-field PATCH', () => {
    const initial = valid()
    const edited = { ...initial, expected_result: 'New expected', actual_result: 'New actual' }
    expect(toUpdateRequest(edited, initial)).toEqual({ expected_result: 'New expected', actual_result: 'New actual' })
    expect(isDirty(initial, initial)).toBe(false)
    expect(isDirty(edited, initial)).toBe(true)
  })

  it('a status move is separate from the field edit and carries its resolution', () => {
    const initial = valid({ status: 'Fixed' })
    const moved = { ...initial, status: 'Closed', resolution: 'Fixed' }
    expect(toUpdateRequest(moved, initial)).toEqual({})
    expect(statusChange(moved, initial)).toEqual({ status: 'Closed', resolution: 'Fixed' })
    expect(statusChange(initial, initial)).toBeNull()
    expect(isDirty(moved, initial)).toBe(true)
  })

  it('a resolution edit without a status move goes through PATCH', () => {
    const initial = valid({ status: 'Closed', resolution: 'Fixed' })
    expect(toUpdateRequest({ ...initial, resolution: 'Duplicate' }, initial)).toEqual({ resolution: 'Duplicate' })
  })

  it('link changes are diffed against the saved set', () => {
    const initial = valid({ test_case_ids: ['a', 'b'] })
    expect(linkDiff(valid({ test_case_ids: ['b', 'c'] }), initial)).toEqual({ add: ['c'], remove: ['a'] })
  })
})

describe('prefilled values', () => {
  const draft = {
    project_id: 'p1',
    test_run_case_id: 'rc1',
    test_case_id: 'tc1',
    test_case_display_id: 'TC_000012',
    title: 'TC_000012 – Login failed',
    description: 'Step 2 failed',
    module_id: 'm1',
    preconditions: 'A user exists',
    repro_steps: [
      { step_no: 1, action: 'Open the page', test_data: null, expected_result: 'Opens', failed: false },
      { step_no: 2, action: 'Submit', test_data: 'x=1', expected_result: 'Saved', failed: true },
    ],
    expected_result: 'Saved',
    actual_result: 'Nothing saved',
    environment: 'QA',
    build_found: null,
  } as unknown as DefectDraft

  it('fills the form from a failed-execution draft, linking the case and flagging the failing step', () => {
    const v = valuesFromDraft(draft, { priority: 'Medium' })
    expect(v.title).toBe('TC_000012 – Login failed')
    expect(v.test_case_ids).toEqual(['tc1'])
    expect(v.steps).toHaveLength(2)
    expect(v.steps[1].failed).toBe(true)
    expect(v.steps[0].failed).toBeUndefined()
    expect(v.priority).toBe('Medium')
    // severity is a conscious choice: the draft does not decide it
    expect(v.severity).toBe('')
    expect(validateForm(v).severity).toBeTruthy()
  })

  it('reads a defect back into the form', () => {
    const d = {
      project_id: 'p1',
      title: 'T title',
      description: 'd',
      module_id: null,
      preconditions: null,
      repro_steps: [{ step_no: 1, action: 'a', expected_result: 'b', test_data: null }],
      expected_result: 'e',
      actual_result: 'a',
      environment: 'QA',
      environment_name: null,
      build_found: null,
      severity: 'High',
      priority: 'Low',
      status: 'Fixed',
      resolution: 'Fixed',
      root_cause: null,
      root_cause_notes: null,
      assigned_to: 'u1',
      fix_version: '2.0',
      labels: ['x'],
      linked_test_cases: [{ id: 'tc1' }],
    } as unknown as Defect
    const v = valuesFromDefect(d)
    expect(v.status).toBe('Fixed')
    expect(v.resolution).toBe('Fixed')
    expect(v.test_case_ids).toEqual(['tc1'])
    expect(v.steps[0].expected).toBe('b')
    expect(isDirty(v, v)).toBe(false)
  })
})
