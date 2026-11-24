import { describe, expect, it } from 'vitest'

import type { MeResponse } from '@/api/auth'

import { activeAdminSection, visibleAdminSections } from './adminSections'

function user(role: string, permissions: string[] = []): MeResponse {
  return { user_id: 'u', tenant_id: 't', email: 'u@example.com', name: 'U', role, permissions }
}

const labels = (u: MeResponse | null) => visibleAdminSections(u).map((s) => s.label)

describe('admin sections', () => {
  it('admin sees all six sections in order', () => {
    expect(labels(user('admin', ['access_rule.manage', 'tenant.settings.manage']))).toEqual([
      'Users & Roles',
      'Access Control',
      'Environments',
      'Settings',
      'Workspace',
      'Audit Logs',
    ])
  })

  it('manager only sees Environments', () => {
    expect(labels(user('manager'))).toEqual(['Environments'])
  })

  it('tester and signed-out users see nothing', () => {
    expect(labels(user('tester'))).toEqual([])
    expect(labels(null)).toEqual([])
  })

  it('Access Control links to the first tab the user may open', () => {
    const custom = user('Custom', ['access_rule.manage'])
    // Not admin: roles is blocked, access-rules is allowed by permission only.
    const section = visibleAdminSections(custom).find((s) => s.label === 'Access Control')
    expect(section?.target).toBe('/admin/access-rules')
    const admin = visibleAdminSections(user('admin')).find((s) => s.label === 'Access Control')
    expect(admin?.target).toBe('/admin/roles')
  })

  it('maps routes to the active section, covering both Access Control tabs and Settings', () => {
    expect(activeAdminSection('/admin/roles')?.label).toBe('Access Control')
    expect(activeAdminSection('/admin/access-rules')?.label).toBe('Access Control')
    expect(activeAdminSection('/settings')?.label).toBe('Settings')
    expect(activeAdminSection('/admin/audit-logs')?.label).toBe('Audit Logs')
    expect(activeAdminSection('/defects')).toBeNull()
  })
})
