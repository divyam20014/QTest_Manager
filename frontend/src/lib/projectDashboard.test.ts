import { describe, expect, it } from 'vitest'

import type { ProjectLayoutWidget } from '@/api/projectDashboard'

import {
  DEFAULT_LAYOUT,
  OPEN_DEFECT_STATUS_PARAM,
  WIDGET_META,
  defectsLink,
  executionLink,
  fromDraft,
  moveDraft,
  percentLabel,
  sameLayout,
  setDraftVisible,
  testCasesLink,
  toDraft,
} from './projectDashboard'

const catalogue = DEFAULT_LAYOUT.map((w) => ({ widget_type: w.widget_type, default_size: w.size }))

describe('project dashboard layout', () => {
  it('has metadata for every built-in widget, in one order', () => {
    expect(DEFAULT_LAYOUT.map((w) => w.widget_type).sort()).toEqual(Object.keys(WIDGET_META).sort())
    expect(new Set(DEFAULT_LAYOUT.map((w) => w.widget_type)).size).toBe(DEFAULT_LAYOUT.length)
  })

  it('builds a draft with the layout first (visible) and everything else hidden', () => {
    const layout: ProjectLayoutWidget[] = [
      { widget_type: 'overdue_cases', size: 'M' },
      { widget_type: 'kpi_strip', size: 'L' },
    ]
    const draft = toDraft(layout, catalogue)
    expect(draft).toHaveLength(catalogue.length)
    expect(draft.slice(0, 2).map((d) => [d.widget_type, d.visible])).toEqual([
      ['overdue_cases', true],
      ['kpi_strip', true],
    ])
    expect(draft.slice(2).every((d) => !d.visible)).toBe(true)
    expect(fromDraft(draft)).toEqual(layout)
  })

  it('ignores unknown and repeated widget types', () => {
    const draft = toDraft(
      [
        { widget_type: 'kpi_strip', size: 'L' },
        { widget_type: 'kpi_strip', size: 'S' },
        { widget_type: 'gone' as never, size: 'S' },
      ],
      catalogue,
    )
    expect(draft.filter((d) => d.visible)).toHaveLength(1)
  })

  it('moves one step and stops at the ends', () => {
    const draft = toDraft(DEFAULT_LAYOUT, catalogue)
    const moved = moveDraft(draft, 1, -1)
    expect(moved[0].widget_type).toBe('test_status')
    expect(moved[1].widget_type).toBe('kpi_strip')
    expect(moveDraft(draft, 0, -1)).toBe(draft)
    expect(moveDraft(draft, draft.length - 1, 1)).toBe(draft)
  })

  it('hides a widget by leaving it out of the stored layout', () => {
    const draft = setDraftVisible(toDraft(DEFAULT_LAYOUT, catalogue), 'tester_performance', false)
    expect(fromDraft(draft).some((w) => w.widget_type === 'tester_performance')).toBe(false)
    expect(fromDraft(draft)).toHaveLength(DEFAULT_LAYOUT.length - 1)
  })

  it('compares layouts by order and size', () => {
    expect(sameLayout(DEFAULT_LAYOUT, [...DEFAULT_LAYOUT])).toBe(true)
    expect(sameLayout(DEFAULT_LAYOUT, DEFAULT_LAYOUT.slice(1))).toBe(false)
    const swapped = [DEFAULT_LAYOUT[1], DEFAULT_LAYOUT[0], ...DEFAULT_LAYOUT.slice(2)]
    expect(sameLayout(DEFAULT_LAYOUT, swapped)).toBe(false)
  })
})

describe('links land on lists that read these filters', () => {
  it('uses the test case list URL keys', () => {
    expect(testCasesLink('p1')).toBe('/projects/p1/test-cases')
    expect(testCasesLink('p1', { executionStatus: 'Not Run' })).toBe('/projects/p1/test-cases?executionStatus=Not+Run')
    expect(testCasesLink('p1', { moduleId: 'm1', executedBy: 'u1' })).toBe(
      '/projects/p1/test-cases?moduleId=m1&executedBy=u1',
    )
  })

  it('uses the defect list URL keys and the Open tab statuses', () => {
    expect(OPEN_DEFECT_STATUS_PARAM).not.toContain('Closed')
    expect(OPEN_DEFECT_STATUS_PARAM).not.toContain('Rejected')
    expect(OPEN_DEFECT_STATUS_PARAM.split(',')).toContain('New')
    expect(defectsLink('p1')).toBe('/defects?projectId=p1')
    const url = new URL(defectsLink('p1', { open: true, severity: 'Critical', reportedBy: 'u1' }), 'http://x')
    expect(url.searchParams.get('projectId')).toBe('p1')
    expect(url.searchParams.get('severity')).toBe('Critical')
    expect(url.searchParams.get('reportedBy')).toBe('u1')
    expect(url.searchParams.get('status')).toBe(OPEN_DEFECT_STATUS_PARAM)
  })

  it('narrows the Execution Console queue', () => {
    expect(executionLink('p1')).toBe('/execution?projectId=p1')
    expect(executionLink('p1', true)).toBe('/execution?projectId=p1&overdue=1')
  })

  it('words a missing percentage as n/a', () => {
    expect(percentLabel(null)).toBe('n/a')
    expect(percentLabel(66.66)).toBe('66.7%')
  })
})
