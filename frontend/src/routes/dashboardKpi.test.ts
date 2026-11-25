import { describe, expect, it } from 'vitest'

import type { Defect } from '@/api/defects'
import type { TestRunSummary } from '@/api/execution'
import { buildNeedsAttention, capCategories, countTrend, kpiAriaLabel, rateTrend } from '@/routes/dashboardKpi'

const defect = (id: string, severity: string, status: string, created_at: string): Defect =>
  ({ id, project_id: 'p1', title: `D-${id}`, severity, status, created_at }) as unknown as Defect
const run = (id: string, paused_at: string | null, finished_at: string | null, created_at: string): TestRunSummary =>
  ({ id, project_id: 'p1', name: `R-${id}`, paused_at, finished_at, created_at }) as unknown as TestRunSummary

describe('countTrend', () => {
  it('has no trend without a usable baseline instead of inventing one', () => {
    expect(countTrend(5, undefined, 30, true).direction).toBe('none')
    expect(countTrend(5, null, 30, true).direction).toBe('none')
    expect(countTrend(5, 0, 30, true).direction).toBe('none')
  })
  it('computes a rounded percentage and tone by whether higher is better', () => {
    expect(countTrend(12, 10, 30, true)).toEqual({ direction: 'up', text: '20% vs 30d ago', tone: 'good' })
    expect(countTrend(12, 10, 30, false).tone).toBe('bad')
    expect(countTrend(5, 10, 30, false)).toEqual({ direction: 'down', text: '50% vs 30d ago', tone: 'good' })
  })
  it('is neutral when unchanged', () => {
    expect(countTrend(10, 10, 30, true)).toMatchObject({ direction: 'flat', tone: 'neutral' })
  })
})

describe('rateTrend', () => {
  it('needs executed steps on both sides', () => {
    expect(rateTrend(0.8, 10, 0.7, 0, 30).direction).toBe('none')
    expect(rateTrend(0, 0, 0.7, 10, 30).direction).toBe('none')
  })
  it('reports percentage points', () => {
    expect(rateTrend(0.85, 20, 0.7, 10, 30)).toEqual({ direction: 'up', text: '15.0 pts vs 30d ago', tone: 'good' })
    expect(rateTrend(0.6, 20, 0.7, 10, 30)).toMatchObject({ direction: 'down', tone: 'bad' })
  })
})

describe('kpiAriaLabel', () => {
  it('includes value and trend in words', () => {
    const label = kpiAriaLabel('Open defects', '7', countTrend(7, 10, 30, false))
    expect(label).toBe('Open defects: 7. down 30% vs 30d ago')
    expect(kpiAriaLabel('Test cases', '3', countTrend(3, 0, 30, true))).toBe('Test cases: 3. No trend yet')
  })
})

describe('buildNeedsAttention', () => {
  it('lists only open Critical/High defects, worst first then newest, then paused unfinished runs', () => {
    const items = buildNeedsAttention(
      [
        defect('a', 'High', 'Open', '2026-01-02'),
        defect('b', 'Critical', 'New', '2026-01-01'),
        defect('c', 'Critical', 'Open', '2026-01-03'),
        defect('d', 'Critical', 'Closed', '2026-01-04'),
        defect('e', 'Medium', 'Open', '2026-01-05'),
      ],
      [
        run('1', '2026-01-01', null, '2026-01-01'),
        run('2', null, null, '2026-01-02'),
        run('3', '2026-01-01', '2026-01-02', '2026-01-02'),
        run('4', '2026-01-03', null, '2026-01-03'),
      ],
    )
    expect(items.map((i) => i.id)).toEqual(['c', 'b', 'a', '4', '1'])
    // Records open inside their project (ADR-127).
    expect(items[0].href).toBe('/projects/p1/defects/c')
    expect(items[3]).toMatchObject({ kind: 'run', badge: 'Paused', href: '/projects/p1/test-runs/4' })
  })
  it('is empty when nothing qualifies', () => {
    expect(buildNeedsAttention([], [])).toEqual([])
  })
})

describe('capCategories', () => {
  const rows = [1, 2, 3, 4, 5, 6, 7].map((n) => ({ key: String(n), count: n }))
  const other = (_: unknown[], count: number) => ({ key: 'other', count })
  it('keeps up to the max untouched', () => {
    expect(capCategories(rows.slice(0, 5), 5, other)).toHaveLength(5)
  })
  it('folds the smallest tail into Other with the right total', () => {
    const out = capCategories(rows, 5, other)
    expect(out).toHaveLength(5)
    expect(out[4]).toEqual({ key: 'other', count: 1 + 2 + 3 })
    expect(out.reduce((s, r) => s + r.count, 0)).toBe(28)
  })
})
