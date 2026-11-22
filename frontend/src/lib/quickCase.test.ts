import { describe, expect, it } from 'vitest'

import {
  MAX_QUICK_STEPS,
  addStepRow,
  carryOver,
  cleanSteps,
  draftToFormValues,
  emptyDraft,
  filterOptions,
  removeStepRow,
  validateDraft,
} from './quickCase'

describe('quick-create helpers', () => {
  it('carryOver keeps priority and module, clears title and steps', () => {
    const next = carryOver({
      title: 'Login works',
      priority: 'High',
      module_id: 'm1',
      steps: [{ action: 'a', expected: 'b' }],
    })
    expect(next).toEqual(emptyDraft('High', 'm1'))
  })

  it('step rows: capped at 3, never below 1', () => {
    let steps = emptyDraft().steps
    for (let i = 0; i < 5; i++) steps = addStepRow(steps)
    expect(steps).toHaveLength(MAX_QUICK_STEPS)
    expect(removeStepRow(emptyDraft().steps, 0)).toHaveLength(1)
    expect(removeStepRow(steps, 1)).toHaveLength(2)
  })

  it('validates title, priority and steps like the full form', () => {
    expect(validateDraft(emptyDraft('High'))).toMatchObject({ title: expect.any(String), steps: expect.any(String) })
    const ok = { ...emptyDraft('High'), title: 'Valid title', steps: [{ action: 'a', expected: 'b' }] }
    expect(validateDraft(ok)).toEqual({})
    expect(validateDraft({ ...ok, steps: [{ action: 'a', expected: '' }] }).stepRow).toBe(0)
    expect(validateDraft({ ...ok, priority: '' }).priority).toBe('Required')
  })

  it('cleanSteps drops blank rows and trims', () => {
    expect(
      cleanSteps([
        { action: ' a ', expected: 'b' },
        { action: '', expected: '' },
      ]),
    ).toEqual([{ action: 'a', expected: 'b' }])
  })

  it('draftToFormValues carries entered values, keeps base steps when none entered', () => {
    const base = { title: '', steps: [{ action: '', expected: '' }], description: 'x' }
    const merged = draftToFormValues(
      { title: 'T title', priority: 'Low', module_id: 'm', steps: [{ action: 'a', expected: '' }] },
      base,
    )
    expect(merged).toMatchObject({ title: 'T title', priority: 'Low', module_id: 'm', description: 'x' })
    expect(merged.steps[0].action).toBe('a')
    expect(draftToFormValues(emptyDraft('Low'), base).steps).toBe(base.steps)
  })

  it('filterOptions matches case-insensitively and hides selected', () => {
    const opts = [
      { id: '1', label: 'Claims intake' },
      { id: '2', label: 'Payment claim' },
      { id: '3', label: 'Login' },
    ]
    expect(filterOptions(opts, 'CLAIM', []).map((o) => o.id)).toEqual(['1', '2'])
    expect(filterOptions(opts, 'claim', ['1']).map((o) => o.id)).toEqual(['2'])
    expect(filterOptions(opts, '', [])).toHaveLength(3)
  })
})
