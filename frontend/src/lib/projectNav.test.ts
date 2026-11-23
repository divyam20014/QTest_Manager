import { describe, expect, it } from 'vitest'

import type { MeResponse } from '@/api/auth'

import {
  DEFAULT_TAB_ORDER,
  PROJECT_TABS,
  activeTabKey,
  approvedProgress,
  fullOrder,
  hiddenTabs,
  isDefaultConfig,
  resolveProjectTabs,
  switchTarget,
} from './projectNav'

function user(role: string, permissions: string[], extra: Partial<MeResponse> = {}): MeResponse {
  return { user_id: 'u', tenant_id: 't', email: 'u@example.com', name: 'U', role, permissions, ...extra }
}

const admin = user('admin', ['project.edit', 'report.view'])
const tester = user('tester', ['report.view'])
const keys = (tabs: { key: string }[]) => tabs.map((t) => t.key)

describe('project tabs', () => {
  it('has the six core tabs, five optional ones and no tab without a real page', () => {
    expect(PROJECT_TABS.filter((t) => t.core).map((t) => t.key)).toEqual([
      'overview',
      'requirements',
      'test-cases',
      'test-runs',
      'defects',
      'reports',
    ])
    const all = PROJECT_TABS.map((t) => t.label).join(',')
    for (const missing of ['Documents', 'Automation', 'Calendar']) expect(all).not.toContain(missing)
    expect(PROJECT_TABS.find((t) => t.key === 'settings')?.hideable).toBe(false)
  })

  it('uses the default order when nothing is saved and shows Settings only with project.edit', () => {
    expect(keys(resolveProjectTabs('p1', null, admin))).toEqual(DEFAULT_TAB_ORDER)
    expect(keys(resolveProjectTabs('p1', null, tester))).toEqual(DEFAULT_TAB_ORDER.filter((k) => k !== 'settings'))
  })

  it('follows a saved order, appends tabs it does not mention and ignores unknown keys', () => {
    const order = fullOrder({ order: ['defects', 'nope', 'overview', 'defects'], hidden: [] })
    expect(order.slice(0, 2)).toEqual(['defects', 'overview'])
    expect(order).toHaveLength(DEFAULT_TAB_ORDER.length)
    expect(new Set(order).size).toBe(order.length)
  })

  it('hides optional tabs but never a core tab or Settings', () => {
    const config = { order: [], hidden: ['team', 'overview', 'settings', 'nope'] }
    expect([...hiddenTabs(config)]).toEqual(['team'])
    const shown = keys(resolveProjectTabs('p1', config, admin))
    expect(shown).not.toContain('team')
    expect(shown).toContain('overview')
    expect(shown).toContain('settings')
  })

  it('hides Reports when the tenant hides it from Testers', () => {
    const hidden = user('tester', ['report.view'], { reports_hidden: true })
    expect(keys(resolveProjectTabs('p1', null, hidden))).not.toContain('reports')
  })

  it('builds the existing URLs for the existing tabs', () => {
    const urls = Object.fromEntries(resolveProjectTabs('p1', null, admin).map((t) => [t.key, t.to]))
    expect(urls.overview).toBe('/projects/p1')
    expect(urls['test-cases']).toBe('/projects/p1/test-cases')
    expect(urls.defects).toBe('/defects?projectId=p1')
    expect(urls.reports).toBe('/reporting?project=p1')
    expect(urls.settings).toBe('/projects/p1/settings')
  })

  it('detects the default configuration', () => {
    expect(isDefaultConfig(DEFAULT_TAB_ORDER, [])).toBe(true)
    expect(isDefaultConfig(DEFAULT_TAB_ORDER, ['team'])).toBe(false)
    expect(isDefaultConfig([...DEFAULT_TAB_ORDER].reverse(), [])).toBe(false)
  })
})

describe('approvedProgress', () => {
  it('is the approved share of the real counts, or null with no test cases', () => {
    expect(approvedProgress({ test_case_count: 0, approved_test_case_count: 0 })).toBeNull()
    expect(approvedProgress({ test_case_count: 4, approved_test_case_count: 1 })).toBe(25)
    expect(approvedProgress({ test_case_count: 3, approved_test_case_count: 3 })).toBe(100)
  })
})

describe('activeTabKey', () => {
  it('maps locations to tabs', () => {
    expect(activeTabKey('/projects/p1', '')).toBe('overview')
    expect(activeTabKey('/projects/p1/', '')).toBe('overview')
    expect(activeTabKey('/projects/p1/traceability-matrix', '')).toBe('requirements')
    expect(activeTabKey('/projects/p1/test-cases/new', '')).toBe('test-cases')
    expect(activeTabKey('/projects/p1/test-plans', '')).toBe('test-plans')
    expect(activeTabKey('/projects/p1/settings', '')).toBe('settings')
    expect(activeTabKey('/defects', '?projectId=p1')).toBe('defects')
    expect(activeTabKey('/reporting', '?project=p1')).toBe('reports')
  })

  it('has no active tab for the legacy details page or unscoped lists', () => {
    expect(activeTabKey('/projects/p1/details', '')).toBeNull()
    expect(activeTabKey('/defects', '')).toBeNull()
    expect(activeTabKey('/test-repository', '')).toBeNull()
  })
})

describe('switchTarget', () => {
  it('keeps the current tab when the target project shows it', () => {
    expect(switchTarget('test-cases', { id: 'p2' }, admin)).toBe('/projects/p2/test-cases')
    expect(switchTarget('defects', { id: 'p2' }, admin)).toBe('/defects?projectId=p2')
  })

  it('falls back to Overview when the target hides the tab or the user cannot see it', () => {
    const target = { id: 'p2', nav_config: { order: [], hidden: ['team'] } }
    expect(switchTarget('team', target, admin)).toBe('/projects/p2')
    expect(switchTarget('settings', { id: 'p2' }, tester)).toBe('/projects/p2')
    expect(switchTarget(null, { id: 'p2' }, admin)).toBe('/projects/p2')
  })
})
