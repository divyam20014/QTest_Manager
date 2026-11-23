import { describe, expect, it } from 'vitest'

import type { DefectRetest } from '@/api/defects'
import {
  DEFECT_STATUSES,
  FALLBACK_TRANSITIONS,
  OPEN_DEFECTS_HREF,
  OPEN_STATUSES,
  STATUS_TABS,
  allowedNextStatuses,
  defaultResolution,
  isClosedStatus,
  planTransition,
  quickActions,
  resolutionExplanation,
  resolutionRule,
  retestOutcome,
  retestsAwaitingResult,
  statusesForTab,
  sumStatusCounts,
  tabKeyForStatuses,
  transitionMenu,
} from './defectWorkflow'

describe('allowed next statuses', () => {
  it('lists only the statuses the table allows, in workflow order', () => {
    expect(allowedNextStatuses('New')).toEqual(['Assigned', 'In Progress', 'Rejected', 'Deferred', 'Open'])
    expect(allowedNextStatuses('Fixed')).toEqual(['Retest', 'Reopened', 'Verified'])
    expect(allowedNextStatuses('Closed')).toEqual(['Reopened'])
  })

  it('prefers the server catalogue over the fallback table', () => {
    const catalog = { transitions: { New: ['Closed'] } } as never
    expect(allowedNextStatuses('New', catalog)).toEqual(['Closed'])
  })

  it('every status has transitions and never lists itself', () => {
    for (const status of DEFECT_STATUSES) {
      expect(FALLBACK_TRANSITIONS[status]?.length, status).toBeGreaterThan(0)
      expect(FALLBACK_TRANSITIONS[status]).not.toContain(status)
    }
  })
})

describe('resolution rules', () => {
  it('open statuses carry no resolution', () => {
    for (const s of ['New', 'Open', 'Assigned', 'In Progress', 'Retest', 'Reopened']) {
      expect(resolutionRule(s).allowed).toEqual([])
      expect(resolutionExplanation(s)).toMatch(/not used/)
    }
  })

  it('Rejected needs one of five, Closed one of six, Deferred allows three optionally', () => {
    expect(resolutionRule('Rejected')).toMatchObject({ required: true })
    expect(resolutionRule('Rejected').allowed).toHaveLength(5)
    expect(resolutionRule('Rejected').allowed).not.toContain('Fixed')
    expect(resolutionRule('Closed')).toMatchObject({ required: true })
    expect(resolutionRule('Closed').allowed).toHaveLength(6)
    expect(resolutionRule('Deferred')).toMatchObject({ required: false })
    expect(resolutionRule('Deferred').allowed).toEqual(["Won't Fix", 'By Design', 'Not Applicable'])
  })

  it('Closed from Fixed / Retest / Verified defaults to Fixed; other moves into Closed must choose', () => {
    expect(defaultResolution('Retest', 'Closed')).toBe('Fixed')
    expect(defaultResolution('Verified', 'Closed')).toBe('Fixed')
    expect(defaultResolution('Rejected', 'Closed')).toBeNull()
    expect(defaultResolution('In Progress', 'Fixed')).toBe('Fixed')
  })
})

describe('transition plan', () => {
  it('asks for a resolution only where one is required and not defaulted', () => {
    expect(planTransition('New', 'Rejected')).toMatchObject({ needsResolution: true, defaultResolution: null })
    expect(planTransition('Retest', 'Closed')).toMatchObject({ needsResolution: false, defaultResolution: 'Fixed', needsVerification: true })
    expect(planTransition('Deferred', 'Closed')).toMatchObject({ needsResolution: true })
    expect(planTransition('New', 'Assigned')).toMatchObject({ needsResolution: false, resolutionOptions: [], needsVerification: false })
    expect(planTransition('Fixed', 'Reopened')).toMatchObject({ needsClosePermission: true })
  })
})

describe('transition menu', () => {
  const tester = { canChangeStatus: true, canClose: false }
  const manager = { canChangeStatus: true, canClose: true }

  it('is empty without permission', () => {
    expect(transitionMenu('New', { canChangeStatus: false, canClose: false })).toEqual([])
  })

  it('shows only allowed next statuses; closing and reopening are disabled with a reason for a tester', () => {
    const menu = transitionMenu('Retest', tester)
    expect(menu.map((o) => o.status)).toEqual(['Reopened', 'Closed', 'Verified'])
    expect(menu.find((o) => o.status === 'Closed')?.disabledReason).toMatch(/close/i)
    expect(menu.find((o) => o.status === 'Reopened')?.disabledReason).toBeTruthy()
    expect(menu.find((o) => o.status === 'Verified')?.disabledReason).toBeUndefined()
  })

  it('a manager can use every option', () => {
    expect(transitionMenu('Retest', manager).every((o) => !o.disabledReason)).toBe(true)
  })
})

describe('quick actions of the detail header', () => {
  const manager = { canChangeStatus: true, canClose: true }
  const tester = { canChangeStatus: true, canClose: false }

  it('Fixed: start retest, reopen and close options follow the permissions', () => {
    expect(quickActions('Fixed', manager)).toEqual({ startRetest: true, reopen: true, close: false, changeStatus: true })
    expect(quickActions('Fixed', tester)).toMatchObject({ startRetest: true, reopen: false, close: false })
  })

  it('Retest can be closed or reopened; New cannot', () => {
    expect(quickActions('Retest', manager)).toMatchObject({ close: true, reopen: true })
    expect(quickActions('New', manager)).toMatchObject({ startRetest: false, close: false, reopen: false })
    expect(quickActions('Closed', manager)).toMatchObject({ reopen: true, close: false })
  })
})

describe('retest results', () => {
  const rc = (over: Partial<DefectRetest>): DefectRetest =>
    ({ test_run_case_id: 'r', run_case_status: 'passed', result: null, ...over }) as DefectRetest

  it('maps the run case status to an outcome', () => {
    expect(retestOutcome('passed')).toBe('pass')
    expect(retestOutcome('failed')).toBe('fail')
    expect(retestOutcome('pending')).toBeNull()
    expect(retestOutcome('blocked')).toBeNull()
  })

  it('only an executed retest of a defect in Retest awaits a result', () => {
    const list = [rc({ test_run_case_id: 'a' }), rc({ test_run_case_id: 'b', run_case_status: 'pending' }), rc({ test_run_case_id: 'c', result: 'pass' })]
    expect(retestsAwaitingResult('Retest', list).map((r) => r.test_run_case_id)).toEqual(['a'])
    expect(retestsAwaitingResult('Fixed', list)).toEqual([])
  })
})

describe('status groups and tabs', () => {
  it('Closed is Closed + Rejected; open is everything else (Deferred is parked, still open)', () => {
    expect(isClosedStatus('Closed')).toBe(true)
    expect(isClosedStatus('Rejected')).toBe(true)
    expect(isClosedStatus('Deferred')).toBe(false)
    expect(OPEN_STATUSES).toContain('Deferred')
    expect(OPEN_STATUSES).toContain('Fixed')
    expect(OPEN_STATUSES).not.toContain('Closed')
    expect(OPEN_STATUSES).not.toContain('Rejected')
    expect(OPEN_STATUSES).toHaveLength(9)
  })

  it('the dashboard KPI link carries the open group', () => {
    expect(OPEN_DEFECTS_HREF.startsWith('/defects?status=')).toBe(true)
    const statuses = (new URL(OPEN_DEFECTS_HREF, 'http://x').searchParams.get('status') ?? '').split(',')
    expect(statuses).toContain('In Progress')
    expect(statuses).not.toContain('Rejected')
    expect(statuses).not.toContain('Closed')
  })

  it('a tab maps to its statuses and back; a custom selection matches no tab', () => {
    for (const tab of STATUS_TABS) expect(tabKeyForStatuses(statusesForTab(tab.key))).toBe(tab.key)
    expect(tabKeyForStatuses([])).toBe('')
    expect(tabKeyForStatuses(['New', 'Closed'])).toBeNull()
    expect(statusesForTab('closed')).toEqual(['Closed', 'Rejected'])
    expect(statusesForTab('')).toEqual([])
  })

  it('sums the per-status counts of a group', () => {
    const counts = { Closed: 4, Rejected: 2, New: 1 }
    expect(sumStatusCounts(counts, statusesForTab('closed'))).toBe(6)
    expect(sumStatusCounts(counts, statusesForTab('open'))).toBe(1)
  })
})
