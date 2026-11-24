import { describe, expect, it } from 'vitest'

import type { MeResponse } from '@/api/auth'

import { NAV_ENTRY_META, NAV_REGISTRY, applyNavConfig, fullNavOrder, hiddenNavIds, navEntryId, resolveRegistry } from './navRegistry'
import { resolveProjectTabs, switchTarget } from './projectNav'
import {
  DEFAULT_WORKSPACE_CONFIG,
  availableModes,
  effectiveNavConfig,
  normalizeWorkspaceConfig,
} from './workspaceConfig'

function user(role: string, permissions: string[]): MeResponse {
  return { user_id: 'u', tenant_id: 't', email: 'u@example.com', name: 'U', role, permissions }
}

const admin = user('admin', ['tenant.settings.manage', 'report.view', 'report.compliance_export'])
const tester = user('tester', ['report.view'])

const ids = (entries: ReturnType<typeof resolveRegistry>) => entries.map((e) => (e.kind === 'link' ? e.item.id : e.group.id))

describe('sidebar defaults (applyNavConfig)', () => {
  it('lists the entries an admin can order, with the core ones locked', () => {
    expect(NAV_ENTRY_META.map((m) => m.id)).toEqual([
      'home',
      'projects',
      'my-work',
      'test-management',
      'test-execution',
      'defects',
      'reports',
      'admin',
    ])
    expect(NAV_ENTRY_META.filter((m) => m.core).map((m) => m.id)).toEqual(['home', 'projects', 'my-work', 'admin'])
  })

  it('is the registry itself when nothing is configured', () => {
    expect(applyNavConfig(NAV_REGISTRY, DEFAULT_WORKSPACE_CONFIG.sidebar)).toBe(NAV_REGISTRY)
    expect(applyNavConfig(NAV_REGISTRY, undefined)).toBe(NAV_REGISTRY)
  })

  it('hides entries and reorders the rest, for every consumer of the resolved list', () => {
    const cfg = { order: ['defects', 'home'], hidden: ['reports', 'test-management'] }
    const resolved = resolveRegistry(admin, applyNavConfig(NAV_REGISTRY, cfg))
    // Test Management is a one-leaf group, so it resolves to the plain Test Cases link (id test-cases):
    // hiding it by group id removes it either way.
    expect(ids(resolved)).toEqual(['defects', 'home', 'projects', 'my-work', 'test-execution', 'admin'])
  })

  it('never hides a core entry, even from a hand-edited config, and ignores unknown ids', () => {
    const cfg = { order: ['nope', 'admin'], hidden: ['home', 'projects', 'my-work', 'admin', 'calendar', 'documents'] }
    const resolved = resolveRegistry(admin, applyNavConfig(NAV_REGISTRY, cfg))
    expect(ids(resolved)).toContain('home')
    expect(ids(resolved)).toContain('projects')
    expect(ids(resolved)).toContain('my-work')
    expect(ids(resolved)[0]).toBe('admin')
    expect(hiddenNavIds(cfg.hidden).size).toBe(0)
  })

  it('keeps permissions on top: an entry the role may not open stays out', () => {
    const resolved = resolveRegistry(tester, applyNavConfig(NAV_REGISTRY, { order: ['admin'], hidden: [] }))
    expect(ids(resolved)).not.toContain('admin')
  })

  it('completes a partial order with the entries it does not mention', () => {
    expect(fullNavOrder(['defects'])).toEqual([
      'defects',
      'home',
      'projects',
      'my-work',
      'test-management',
      'test-execution',
      'reports',
      'admin',
    ])
    expect(NAV_REGISTRY.map(navEntryId)).toEqual(NAV_ENTRY_META.map((m) => m.id))
  })
})

describe('normalizeWorkspaceConfig', () => {
  it('falls back to the defaults for anything odd', () => {
    expect(normalizeWorkspaceConfig(null)).toBe(DEFAULT_WORKSPACE_CONFIG)
    expect(normalizeWorkspaceConfig('x')).toBe(DEFAULT_WORKSPACE_CONFIG)
    expect(normalizeWorkspaceConfig({ sidebar: 5, project_tabs: [], view_modes: 3 })).toEqual(DEFAULT_WORKSPACE_CONFIG)
  })

  it('drops unknown lists and modes and non-string ids', () => {
    const got = normalizeWorkspaceConfig({
      sidebar: { order: ['defects', 4], hidden: ['reports'] },
      project_tabs: { order: ['team'], hidden: [] },
      view_modes: { defects: ['list', 'gantt'], projects: ['list'] },
    })
    expect(got.sidebar).toEqual({ order: ['defects'], hidden: ['reports'] })
    expect(got.view_modes).toEqual({ defects: ['list'] })
  })
})

describe('list view modes', () => {
  const builtIn = ['list', 'board', 'calendar'] as const
  it('offers every built-in mode when nothing is configured', () => {
    expect(availableModes(DEFAULT_WORKSPACE_CONFIG, 'test_runs', builtIn)).toBe(builtIn)
  })
  it('narrows to the chosen modes, always keeps list and keeps the built-in order', () => {
    const cfg = { ...DEFAULT_WORKSPACE_CONFIG, view_modes: { test_runs: ['calendar' as const] } }
    expect(availableModes(cfg, 'test_runs', builtIn)).toEqual(['list', 'calendar'])
    const only = { ...DEFAULT_WORKSPACE_CONFIG, view_modes: { test_runs: ['list' as const] } }
    expect(availableModes(only, 'test_runs', builtIn)).toEqual(['list'])
    expect(availableModes(only, 'defects', ['list', 'board'])).toEqual(['list', 'board'])
  })
})

describe('project tab defaults', () => {
  const tenant = { ...DEFAULT_WORKSPACE_CONFIG, project_tabs: { order: ['defects'], hidden: ['releases'] } }
  const keys = (cfg: Parameters<typeof resolveProjectTabs>[1]) => resolveProjectTabs('p1', cfg, admin).map((t) => t.key)

  it('a project without its own config follows the tenant default; its own config wins', () => {
    expect(effectiveNavConfig(null, tenant)).toBe(tenant.project_tabs)
    const own = { order: ['team'], hidden: [] }
    expect(effectiveNavConfig(own, tenant)).toBe(own)
    expect(keys(effectiveNavConfig(null, tenant))[0]).toBe('defects')
    expect(keys(effectiveNavConfig(null, tenant))).not.toContain('releases')
    expect(keys(effectiveNavConfig(own, tenant))).toContain('releases')
  })

  it('the project switcher uses the tenant default for a target with no config', () => {
    expect(switchTarget('releases', { id: 'p2', nav_config: null }, admin, tenant.project_tabs)).toBe('/projects/p2')
    expect(switchTarget('releases', { id: 'p2', nav_config: null }, admin, null)).toBe('/projects/p2/releases')
  })
})
