import { describe, expect, it } from 'vitest'

import type { MeResponse } from '@/api/auth'

import {
  DEFAULT_TAB_ORDER,
  PROJECT_TABS,
  activeTabKey,
  approvedProgress,
  canEditProject,
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
  it('has eight tabs: five core, three optional, none without a real page', () => {
    expect(DEFAULT_TAB_ORDER).toEqual([
      'overview',
      'tasks',
      'test-cases',
      'test-runs',
      'defects',
      'reports',
      'planning',
      'team',
    ])
    expect(PROJECT_TABS.filter((t) => t.core).map((t) => t.key)).toEqual([
      'overview',
      'test-cases',
      'test-runs',
      'defects',
      'reports',
    ])
    const all = PROJECT_TABS.map((t) => t.label).join(',')
    for (const missing of ['Documents', 'Automation', 'Calendar', 'Settings', 'Activity', 'Releases']) {
      expect(all).not.toContain(missing)
    }
  })

  it('uses the default order when nothing is saved, for every role; editing is a separate check', () => {
    expect(keys(resolveProjectTabs('p1', null, admin))).toEqual(DEFAULT_TAB_ORDER)
    expect(keys(resolveProjectTabs('p1', null, tester))).toEqual(DEFAULT_TAB_ORDER)
    expect(canEditProject(admin)).toBe(true)
    expect(canEditProject(tester)).toBe(false)
  })

  it('follows a saved order, appends tabs it does not mention and ignores unknown keys', () => {
    const order = fullOrder({ order: ['defects', 'nope', 'overview', 'defects'], hidden: [] })
    expect(order.slice(0, 2)).toEqual(['defects', 'overview'])
    expect(order).toHaveLength(DEFAULT_TAB_ORDER.length)
    expect(new Set(order).size).toBe(order.length)
  })

  it('hides optional tabs but never a core tab', () => {
    const config = { order: [], hidden: ['team', 'overview', 'nope'] }
    expect([...hiddenTabs(config)]).toEqual(['team'])
    const shown = keys(resolveProjectTabs('p1', config, admin))
    expect(shown).not.toContain('team')
    expect(shown).toContain('overview')
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
    expect(urls.planning).toBe('/projects/p1/test-plans')
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
    expect(activeTabKey('/projects/p1/traceability-matrix', '')).toBe('reports')
    expect(activeTabKey('/projects/p1/test-cases/new', '')).toBe('test-cases')
    expect(activeTabKey('/projects/p1/test-plans', '')).toBe('planning')
    expect(activeTabKey('/projects/p1/releases', '')).toBe('planning')
    // Reached from the header, so no tab is current.
    expect(activeTabKey('/projects/p1/settings', '')).toBeNull()
    expect(activeTabKey('/projects/p1/activity', '')).toBeNull()
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
    expect(switchTarget(null, { id: 'p2' }, admin)).toBe('/projects/p2')
  })
})

describe('Tasks tab (ADR-127)', () => {
  it('is an optional tab right after Overview that every member can open', () => {
    const tasks = PROJECT_TABS.find((t) => t.key === 'tasks')
    expect(tasks).toMatchObject({ label: 'Tasks', core: false, hideable: true })
    expect(tasks?.to('p1')).toBe('/projects/p1/tasks')
    expect(DEFAULT_TAB_ORDER.slice(0, 3)).toEqual(['overview', 'tasks', 'test-cases'])
    expect(keys(resolveProjectTabs('p1', null, tester))).toContain('tasks')
  })

  it('can be hidden, and a saved order without it still shows it at the end', () => {
    expect(keys(resolveProjectTabs('p1', { order: [], hidden: ['tasks'] }, admin))).not.toContain('tasks')
    const legacy = { order: ['overview', 'requirements', 'test-cases'], hidden: [] }
    expect(fullOrder(legacy)).toContain('tasks')
  })

  it('maps its URL to the tab', () => {
    expect(activeTabKey('/projects/p1/tasks', '')).toBe('tasks')
  })
})

describe('record pages keep their tab (ADR-127)', () => {
  it('maps requirement, test case, run and defect pages to their tabs', () => {
    // ADR-128: requirements live in tasks, so a requirement page belongs to the Tasks tab.
    expect(activeTabKey('/projects/p1/requirements/r1', '')).toBe('tasks')
    expect(activeTabKey('/projects/p1/test-cases/c1/edit', '')).toBe('test-cases')
    expect(activeTabKey('/projects/p1/test-runs/u1', '')).toBe('test-runs')
    expect(activeTabKey('/projects/p1/defects/d1', '')).toBe('defects')
    expect(activeTabKey('/projects/p1/defects/new', '')).toBe('defects')
    expect(activeTabKey('/projects/p1/tasks/t1', '')).toBe('tasks')
  })
})

describe('the Requirements tab is gone (ADR-128)', () => {
  it('is not a tab, and a saved layout that still names it is read without it', () => {
    expect(PROJECT_TABS.map((t) => t.key)).not.toContain('requirements')
    const saved = { order: ['overview', 'requirements', 'defects'], hidden: [] }
    expect(fullOrder(saved).slice(0, 2)).toEqual(['overview', 'defects'])
    expect(keys(resolveProjectTabs('p1', saved, admin))).not.toContain('requirements')
  })
})
