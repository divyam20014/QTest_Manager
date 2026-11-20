import { describe, expect, it } from 'vitest'

import { countStepChanges, diffWords, summarizeCompare } from './versionDiff'

describe('diffWords', () => {
  it('returns one same segment for identical text', () => {
    expect(diffWords('open the claim', 'open the claim')).toEqual([{ op: 'same', text: 'open the claim' }])
  })

  it('marks a replaced word as removed then added, keeping the rest', () => {
    expect(diffWords('open the claim now', 'open the policy now')).toEqual([
      { op: 'same', text: 'open the ' },
      { op: 'del', text: 'claim' },
      { op: 'add', text: 'policy' },
      { op: 'same', text: ' now' },
    ])
  })

  it('handles pure additions and pure removals', () => {
    expect(diffWords('', 'new text')).toEqual([{ op: 'add', text: 'new text' }])
    expect(diffWords('old text', null)).toEqual([{ op: 'del', text: 'old text' }])
    expect(diffWords(undefined, undefined)).toEqual([])
  })

  it('re-joins to the original and the new text', () => {
    const a = 'enter the payout amount and submit'
    const b = 'enter the total payout and then submit'
    const segs = diffWords(a, b)
    expect(segs.filter((s) => s.op !== 'add').map((s) => s.text).join('')).toBe(a)
    expect(segs.filter((s) => s.op !== 'del').map((s) => s.text).join('')).toBe(b)
  })
})

describe('summarizeCompare', () => {
  const step = (change: 'added' | 'removed' | 'modified' | 'unchanged') => ({ change })

  it('counts step changes', () => {
    expect(countStepChanges([step('modified'), step('modified'), step('added'), step('unchanged')])).toEqual({
      changed: 2,
      added: 1,
      removed: 0,
      unchanged: 1,
    })
  })

  it('summarises steps', () => {
    expect(
      summarizeCompare({
        title_changed: false,
        description_changed: false,
        steps: [step('modified'), step('modified'), step('added'), step('unchanged')],
      }),
    ).toBe('2 steps changed, 1 added')
  })

  it('includes fields, singular step and removals', () => {
    expect(
      summarizeCompare({
        title_changed: true,
        description_changed: true,
        steps: [step('modified'), step('removed')],
      }),
    ).toBe('Title changed, description changed, 1 step changed, 1 removed')
  })

  it('says so when nothing differs', () => {
    expect(summarizeCompare({ title_changed: false, description_changed: false, steps: [step('unchanged')] })).toBe(
      'No differences between these versions',
    )
  })
})
