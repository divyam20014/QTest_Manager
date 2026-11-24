import { describe, expect, it } from 'vitest'

import { daysUntil, dueRelative, formatDueDate, isOverdue, todayIso } from './dueDate'

describe('dueDate', () => {
  it('uses the UTC calendar date as today', () => {
    expect(todayIso(new Date('2026-03-10T23:59:59Z'))).toBe('2026-03-10')
    expect(todayIso(new Date('2026-03-11T00:00:01Z'))).toBe('2026-03-11')
  })

  it('is overdue only when past due and not yet executed', () => {
    expect(isOverdue('2026-03-09', 'pending', '2026-03-10')).toBe(true)
    expect(isOverdue('2026-03-09', 'in_progress', '2026-03-10')).toBe(true)
    expect(isOverdue('2026-03-10', 'pending', '2026-03-10')).toBe(false)
    expect(isOverdue('2026-03-09', 'passed', '2026-03-10')).toBe(false)
    expect(isOverdue('2026-03-09', 'blocked', '2026-03-10')).toBe(false)
    expect(isOverdue(null, 'pending', '2026-03-10')).toBe(false)
  })

  it('counts whole days across month ends', () => {
    expect(daysUntil('2026-04-02', '2026-03-30')).toBe(3)
    expect(daysUntil('2026-03-28', '2026-03-30')).toBe(-2)
  })

  it('words the distance', () => {
    expect(dueRelative('2026-03-10', '2026-03-10')).toBe('Due today')
    expect(dueRelative('2026-03-11', '2026-03-10')).toBe('Due tomorrow')
    expect(dueRelative('2026-03-15', '2026-03-10')).toBe('Due in 5 days')
    expect(dueRelative('2026-03-09', '2026-03-10')).toBe('1 day overdue')
    expect(dueRelative('2026-03-05', '2026-03-10')).toBe('5 days overdue')
  })

  it('formats a date and tolerates garbage', () => {
    expect(formatDueDate('2026-03-05')).toContain('2026')
    expect(formatDueDate('nope')).toBe('nope')
  })
})
