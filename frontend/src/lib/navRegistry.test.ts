import { describe, expect, it } from 'vitest'

import type { MeResponse } from '@/api/auth'

import {
  NAV_REGISTRY,
  activeGroupId,
  isLeafActive,
  leafBadge,
  paletteEntries,
  resolveRegistry,
  sheetSections,
} from './navRegistry'

function user(role: string, permissions: string[], extra: Partial<MeResponse> = {}): MeResponse {
  return { user_id: 'u', tenant_id: 't', email: 'u@example.com', name: 'U', role, permissions, ...extra }
}

const admin = user('admin', ['tenant.settings.manage', 'report.view', 'report.compliance_export'])
const manager = user('manager', ['project.view.all', 'report.view', 'report.compliance_export'])
const tester = user('tester', ['report.view'])

const labels = (entries: ReturnType<typeof resolveRegistry>) =>
  entries.map((e) => (e.kind === 'link' ? e.item.label : `${e.group.label}[${e.group.items.map((i) => i.label).join(',')}]`))

const topLinks = () => NAV_REGISTRY.flatMap((e) => (e.kind === 'link' ? [e.item] : []))

describe('nav registry', () => {
  it('shows an admin the full structure with real pages only', () => {
    expect(labels(resolveRegistry(admin))).toEqual([
      'Dashboard',
      'Projects',
      'My Work',
      'Test Cases',
      'Test Execution[Test Runs,Execution Console]',
      'Defects',
      'Reports & Analytics[Reports,Compliance Reports]',
      'Admin',
    ])
  })

  it('does not list modules that have no page (Calendar, Documents, Test Automation)', () => {
    const all = JSON.stringify(NAV_REGISTRY.map((e) => (e.kind === 'link' ? e.item.label : e.group.label)))
    for (const missing of ['Calendar', 'Documents', 'Automation', 'Releases', 'Team']) {
      expect(all).not.toContain(missing)
    }
  })

  it('filters by the same access rules as the route gate', () => {
    // Manager: no Users & Roles, but Environments is theirs, so Admin stays and points there.
    const m = resolveRegistry(manager)
    const adminLeaf = m.find((e) => e.kind === 'link' && e.item.id === 'admin')
    expect(adminLeaf && adminLeaf.kind === 'link' && adminLeaf.item.to).toBe('/admin/environments')
    // Tester: no admin, and the single remaining Reports link replaces its one-item group.
    expect(labels(resolveRegistry(tester))).toEqual([
      'Dashboard',
      'Projects',
      'My Work',
      'Test Cases',
      'Test Execution[Test Runs,Execution Console]',
      'Defects',
      'Reports',
    ])
  })

  it('hides Reports from a tester when the tenant hides them', () => {
    const hidden = user('tester', ['report.view'], { reports_hidden: true })
    expect(labels(resolveRegistry(hidden))).not.toContain('Reports')
  })

  it('marks the leaf and the group holding the current route', () => {
    const entries = resolveRegistry(admin)
    expect(activeGroupId(entries, '/test-runs/abc')).toBe('test-execution')
    expect(activeGroupId(entries, '/test-run-cases/abc')).toBe('test-execution')
    expect(activeGroupId(entries, '/reporting/builder')).toBe('reports')
    expect(activeGroupId(entries, '/defects')).toBeNull()
    const home = topLinks()[0]
    expect(isLeafActive(home, '/')).toBe(true)
    expect(isLeafActive(home, '/projects')).toBe(false)
  })

  it('never marks the new-tab compliance link as the current page', () => {
    const entries = resolveRegistry(admin)
    const group = entries.find((e) => e.kind === 'group' && e.group.id === 'reports')
    const compliance = group && group.kind === 'group' ? group.group.items[1] : null
    expect(compliance && isLeafActive(compliance, '/reporting/print')).toBe(false)
  })

  it('badges come from real counts and hide at zero', () => {
    const defects = topLinks().find((i) => i.id === 'defects')!
    const myWork = topLinks().find((i) => i.id === 'my-work')!
    expect(leafBadge(defects, { defects: 4, myWork: 2 })).toEqual({ count: 4, noun: 'open' })
    expect(leafBadge(myWork, { defects: 4, myWork: 2 })).toEqual({ count: 2, noun: 'pending' })
    expect(leafBadge(topLinks()[0], { defects: 4, myWork: 2 })).toBeNull()
  })

  it('feeds the palette and the phone sheet from the same resolved entries', () => {
    const entries = resolveRegistry(admin)
    expect(paletteEntries(entries).map((p) => p.label)).toContain('Execution Console')
    const sheet = sheetSections(entries, { defects: 3, myWork: 0 })
    expect(sheet.map((s) => s.label)).toEqual(['Workspace', 'Test Execution', 'Reports & Analytics'])
    const defects = sheet[0].items.find((i) => i.label === 'Defects')
    expect(defects?.count).toBe(3)
    expect(defects?.countNoun).toBe('open')
  })
})
