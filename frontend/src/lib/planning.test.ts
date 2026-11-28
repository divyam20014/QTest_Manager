import { describe, expect, it } from 'vitest'

import {
  dependencyWarning,
  formatHours,
  isPastDue,
  localToday,
  moveTarget,
  percentDone,
  sprintFlags,
  totalHours,
  waitingLabel,
} from '@/lib/planning'

describe('hours', () => {
  it('drops trailing zeros and shows a dash for no estimate', () => {
    expect(formatHours('2.50')).toBe('2.5 h')
    expect(formatHours('0.00')).toBe('0 h')
    expect(formatHours(null)).toBe('—')
  })

  it('adds without rounding drift and counts what has no estimate', () => {
    const tasks = [{ estimate_hours: '0.10' }, { estimate_hours: '0.20' }, { estimate_hours: null }]
    expect(totalHours(tasks)).toEqual({ hours: 0.3, unestimated: 1 })
  })
})

describe('moveTarget', () => {
  const ids = ['a', 'b', 'c', 'd']

  it('says which task to place the moved one before', () => {
    expect(moveTarget(ids, 2, 'top', false)).toBe('a')
    expect(moveTarget(ids, 2, 'up', false)).toBe('b')
    expect(moveTarget(ids, 0, 'down', false)).toBe('c')
    expect(moveTarget(ids, 2, 'down', false)).toBeNull()
  })

  it('refuses moves that go nowhere', () => {
    expect(moveTarget(ids, 0, 'up', false)).toBeUndefined()
    expect(moveTarget(ids, 0, 'top', false)).toBeUndefined()
    expect(moveTarget(ids, 3, 'down', false)).toBeUndefined()
  })

  it('does not send a task to the very end when the next one is simply not loaded', () => {
    expect(moveTarget(ids, 2, 'down', true)).toBeUndefined()
    expect(moveTarget(ids, 1, 'down', true)).toBe('d')
  })
})

describe('milestone dates and progress', () => {
  it('writes today as the date fields do, in local time', () => {
    expect(localToday(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05')
  })

  it('calls a date past only after the day itself', () => {
    expect(isPastDue('2026-11-27', '2026-11-28')).toBe(true)
    expect(isPastDue('2026-11-28', '2026-11-28')).toBe(false)
    expect(isPastDue(null, '2026-11-28')).toBe(false)
  })

  it('shows no progress for a milestone without tasks', () => {
    expect(percentDone(0, 0)).toBe(0)
    expect(percentDone(1, 3)).toBe(33)
  })
})

describe('sprintFlags', () => {
  const task = { added_after_start: false, removed_at: null, done: false, deleted: false }
  const labels = (over: Partial<Parameters<typeof sprintFlags>[0]>, state: 'active' | 'closed') =>
    sprintFlags({ ...task, ...over }, state).map((f) => f.label)

  it('calls unfinished work "Not done" only once the sprint has closed', () => {
    expect(labels({}, 'active')).toEqual([])
    expect(labels({}, 'closed')).toEqual(['Not done'])
    expect(labels({ done: true }, 'closed')).toEqual(['Done'])
  })

  it('keeps how a task joined and left', () => {
    expect(labels({ added_after_start: true, removed_at: '2026-12-02T00:00:00Z', deleted: true }, 'closed')).toEqual([
      'Added after start',
      'Removed',
      'Task deleted',
    ])
  })
})

describe('dependencies', () => {
  it('warns only while an earlier task is open', () => {
    expect(dependencyWarning(0)).toBeNull()
    expect(dependencyWarning(1)).toContain('A task that should finish first')
    expect(dependencyWarning(3)).toContain('3 tasks')
  })

  it('stops flagging a task once it is done', () => {
    expect(waitingLabel({ open_dependency_count: 2, status: { category: 'todo' } })).toBe('Waiting on 2')
    expect(waitingLabel({ open_dependency_count: 2, status: { category: 'done' } })).toBeNull()
    expect(waitingLabel({ status: { category: 'todo' } })).toBeNull()
  })
})
