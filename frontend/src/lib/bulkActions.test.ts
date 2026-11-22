import { describe, expect, it } from 'vitest'

import { ApiError } from '@/api/client'
import { failureReason, runLimited, summarizeOutcomes } from './bulkActions'

describe('runLimited', () => {
  it('never runs more than the concurrency limit and keeps order', async () => {
    let active = 0
    let peak = 0
    const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g']
    const out = await runLimited(ids, async () => {
      active++
      peak = Math.max(peak, active)
      await new Promise((r) => setTimeout(r, 5))
      active--
    })
    expect(peak).toBeLessThanOrEqual(3)
    expect(out.map((o) => o.id)).toEqual(ids)
    expect(out.every((o) => o.ok)).toBe(true)
  })

  it('records per-item failures without stopping the rest', async () => {
    const out = await runLimited(['a', 'b', 'c'], async (id) => {
      if (id === 'b') throw new ApiError('Not allowed', 'forbidden', 403)
    })
    expect(out.map((o) => o.ok)).toEqual([true, false, true])
    expect(out[1].error).toBe('Not allowed')
  })

  it('handles an empty list', async () => {
    expect(await runLimited([], async () => {})).toEqual([])
  })
})

describe('failureReason / summarizeOutcomes', () => {
  it('names the access rule for blocked items', () => {
    expect(failureReason(new ApiError('Outside hours', 'blocked_by_access_rule', 403))).toBe(
      'Blocked by access rule: Outside hours',
    )
  })

  it('summarises counts and distinct reasons', () => {
    const s = summarizeOutcomes([
      { id: '1', ok: true, error: null },
      { id: '2', ok: false, error: 'x' },
      { id: '3', ok: false, error: 'x' },
    ])
    expect(s).toEqual({ message: '1 updated, 2 failed (x)', failed: 2 })
  })
})
