import { describe, expect, it } from 'vitest'

import type { MeResponse } from '@/api/auth'

import {
  NAV_REGISTRY,
  PALETTE_EXTRA_ENTRIES,
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

const labels = (entries: ReturnType<typeof resolveRegistry>) => entries.map((e) => e.label)

const leaf = (id: string) => NAV_REGISTRY.find((i) => i.id === id)!
const activeIds = (pathname: string) => resolveRegistry(admin).filter((e) => isLeafActive(e, pathname)).map((e) => e.id)

describe('nav registry', () => {
  it('shows an admin one flat list of real pages', () => {
    expect(labels(resolveRegistry(admin))).toEqual([
      'Dashboard',
      'My Work',
      'Projects',
      'Test Cases',
      'Test Runs',
      'Defects',
      'Reports',
      'Admin',
    ])
  })

  it('does not list modules that have no page (Calendar, Documents, Test Automation)', () => {
    const all = JSON.stringify(NAV_REGISTRY.map((e) => e.label))
    for (const missing of ['Calendar', 'Documents', 'Automation', 'Releases', 'Team']) {
      expect(all).not.toContain(missing)
    }
  })

  it('filters by the same access rules as the route gate', () => {
    // Manager: no Users & Roles, but Environments is theirs, so Admin stays and points there.
    expect(resolveRegistry(manager).find((e) => e.id === 'admin')?.to).toBe('/admin/environments')
    expect(labels(resolveRegistry(tester))).toEqual([
      'Dashboard',
      'My Work',
      'Projects',
      'Test Cases',
      'Test Runs',
      'Defects',
      'Reports',
    ])
  })

  it('hides Reports from a tester when the tenant hides them', () => {
    const hidden = user('tester', ['report.view'], { reports_hidden: true })
    expect(labels(resolveRegistry(hidden))).not.toContain('Reports')
  })

  it('keeps the entry lit on the pages opened from it', () => {
    expect(activeIds('/test-runs/abc')).toEqual(['test-runs'])
    expect(activeIds('/execution')).toEqual(['test-runs'])
    expect(activeIds('/test-run-cases/abc')).toEqual(['test-runs'])
    expect(activeIds('/reporting/print')).toEqual(['reports'])
    expect(activeIds('/reporting/builder')).toEqual(['reports'])
    expect(isLeafActive(leaf('home'), '/')).toBe(true)
    expect(isLeafActive(leaf('home'), '/projects')).toBe(false)
  })

  it('badges come from real counts and hide at zero', () => {
    expect(leafBadge(leaf('defects'), { defects: 4, myWork: 2 })).toEqual({ count: 4, noun: 'open' })
    expect(leafBadge(leaf('my-work'), { defects: 4, myWork: 2 })).toEqual({ count: 2, noun: 'pending' })
    expect(leafBadge(leaf('home'), { defects: 4, myWork: 2 })).toBeNull()
  })

  it('feeds the palette and the phone sheet from the same resolved entries', () => {
    const entries = resolveRegistry(admin)
    expect(paletteEntries(entries).map((x) => x.label)).toEqual(labels(entries))
    // The pages that left the menu are still one search away.
    expect(PALETTE_EXTRA_ENTRIES.map((x) => x.path)).toEqual(expect.arrayContaining(['/execution', '/reporting/print']))
    const sheet = sheetSections(entries, { defects: 3, myWork: 0 })
    expect(sheet.map((x) => x.label)).toEqual(['Workspace'])
    const defects = sheet[0].items.find((i) => i.label === 'Defects')
    expect(defects?.count).toBe(3)
    expect(defects?.countNoun).toBe('open')
  })
})
