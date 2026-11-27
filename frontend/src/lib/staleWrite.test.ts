import { describe, expect, it } from 'vitest'
import { ApiError } from '@/api/client'
import { fieldLabel, isStaleWrite, rebaseValues } from '@/lib/staleWrite'

const opened = {
  title: 'Original',
  priority: 'High',
  notes: 'n',
  steps: [{ key: 'a', action: 'Open' }],
}

describe('rebaseValues', () => {
  it("keeps the user's entries and takes everything they did not touch from the latest copy", () => {
    const mine = { ...opened, title: 'My title' }
    const latest = { ...opened, priority: 'Low', steps: [{ key: 'z', action: 'Open the claim' }] }

    const { values, bothChanged } = rebaseValues(mine, opened, latest)

    expect(values).toEqual({ title: 'My title', priority: 'Low', notes: 'n', steps: latest.steps })
    expect(bothChanged).toEqual([])
  })

  it('names the fields both people changed, and keeps the unsaved entry', () => {
    const mine = { ...opened, title: 'Mine', steps: [{ key: 'a', action: 'My step' }] }
    const latest = { ...opened, title: 'Theirs', steps: [{ key: 'z', action: 'Their step' }] }

    const { values, bothChanged } = rebaseValues(mine, opened, latest)

    expect(values.title).toBe('Mine')
    expect(values.steps).toEqual(mine.steps)
    expect(bothChanged).toEqual(['title', 'steps'])
  })

  it('ignores the client-only step key, and the same change made twice is no conflict', () => {
    const reopened = { ...opened, steps: [{ key: 'other', action: 'Open' }] }
    expect(rebaseValues(reopened, opened, { ...opened, notes: 'new' }).values.notes).toBe('new')
    const both = { ...opened, title: 'Agreed' }
    expect(rebaseValues(both, opened, both).bothChanged).toEqual([])
  })
})

describe('stale write errors', () => {
  it('are told apart from other conflicts', () => {
    expect(isStaleWrite(new ApiError('x', 'stale_write', 409))).toBe(true)
    expect(isStaleWrite(new ApiError('x', 'conflict', 409))).toBe(false)
    expect(isStaleWrite(new Error('x'))).toBe(false)
  })

  it('name fields in words', () => {
    expect(fieldLabel('expected_result')).toBe('Expected result')
    expect(fieldLabel('assigned_to')).toBe('Assignee')
  })
})
