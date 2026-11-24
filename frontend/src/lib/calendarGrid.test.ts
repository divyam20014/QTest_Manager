import { describe, expect, it } from 'vitest'

import { addDays, gridRange, monthGrid, parseMonth, shiftMonth } from './calendarGrid'

describe('calendarGrid', () => {
  it('builds six Monday-first weeks that contain the month', () => {
    const grid = monthGrid('2026-11') // 1 Nov 2026 is a Sunday
    expect(grid).toHaveLength(42)
    expect(grid[0]).toBe('2026-10-26')
    expect(grid).toContain('2026-11-30')
    expect(new Date(`${grid[0]}T00:00:00Z`).getUTCDay()).toBe(1)
  })

  it('starts on the 1st when it is a Monday', () => {
    expect(monthGrid('2026-06')[0]).toBe('2026-06-01')
  })

  it('shifts months across year ends and validates the value', () => {
    expect(shiftMonth('2026-12', 1)).toBe('2027-01')
    expect(shiftMonth('2026-01', -1)).toBe('2025-12')
    expect(shiftMonth('2026-03', -14)).toBe('2025-01')
    expect(parseMonth('2026-13')).toBeNull()
    expect(parseMonth('abc')).toBeNull()
    expect(parseMonth('2026-02')).toBe('2026-02')
  })

  it('stays inside the 62-day range the API accepts', () => {
    const { from, to } = gridRange('2026-02')
    expect((Date.parse(to) - Date.parse(from)) / 86_400_000 + 1).toBeLessThanOrEqual(62)
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01')
  })
})
