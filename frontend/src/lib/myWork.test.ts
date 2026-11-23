import { describe, expect, it } from 'vitest'

import type { Defect } from '@/api/defects'
import type { MyRunCase } from '@/api/myWork'

import { groupRunCases, mergeMyDefects } from './myWork'

const rc = (id: string, status: MyRunCase['status']): MyRunCase => ({
  id,
  run_id: 'r',
  run_name: 'Run',
  run_paused: false,
  project_id: 'p',
  project_name: 'P',
  test_case_id: 'c',
  test_case_display_id: null,
  title: id,
  status,
  blocked_reason: null,
  started_at: null,
})
const defect = (id: string, created_at: string) => ({ id, created_at }) as unknown as Defect

describe('my work helpers', () => {
  it('groups run cases in working order and omits empty groups', () => {
    const groups = groupRunCases([rc('a', 'pending'), rc('b', 'failed'), rc('c', 'in_progress'), rc('d', 'pending')])
    expect(groups.map((g) => [g.status, g.items.map((i) => i.id)])).toEqual([
      ['in_progress', ['c']],
      ['failed', ['b']],
      ['pending', ['a', 'd']],
    ])
  })

  it('merges assigned and reported defects into one row each, newest first', () => {
    const merged = mergeMyDefects(
      [defect('1', '2026-01-01'), defect('2', '2026-03-01')],
      [defect('2', '2026-03-01'), defect('3', '2026-02-01')],
    )
    expect(merged.map((m) => [m.defect.id, m.reason])).toEqual([
      ['2', 'both'],
      ['3', 'reported'],
      ['1', 'assigned'],
    ])
  })
})
