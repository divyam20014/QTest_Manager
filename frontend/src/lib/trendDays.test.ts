import { describe, expect, it } from 'vitest'

import { fillDays } from './trendDays'

const ZERO = { count: 0 }

describe('fillDays', () => {
  it('adds the quiet days between two active ones, across a month end', () => {
    const filled = fillDays([{ date: '2026-10-30', count: 3 }, { date: '2026-11-02', count: 5 }], ZERO)
    expect(filled).toEqual([
      { date: '2026-10-30', count: 3 },
      { date: '2026-10-31', count: 0 },
      { date: '2026-11-01', count: 0 },
      { date: '2026-11-02', count: 5 },
    ])
  })

  it('leaves consecutive days, a single day and no data as they are', () => {
    const two = [{ date: '2026-11-01', count: 1 }, { date: '2026-11-02', count: 2 }]
    expect(fillDays(two, ZERO)).toEqual(two)
    expect(fillDays(two.slice(0, 1), ZERO)).toEqual(two.slice(0, 1))
    expect(fillDays<{ date: string; count: number }>([], ZERO)).toEqual([])
  })
})
