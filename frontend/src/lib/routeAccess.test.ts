import { describe, expect, it } from 'vitest'

import type { MeResponse } from '@/api/auth'

import { accessRuleForPath, canAccessPath } from './routeAccess'

function user(role: string, permissions: string[]): MeResponse {
  return { user_id: 'u', tenant_id: 't', email: 'u@example.com', name: 'U', role, permissions }
}

const admin = user('admin', ['tenant.settings.manage', 'report.view', 'report.compliance_export'])
const manager = user('manager', ['project.view.all', 'report.view', 'report.compliance_export'])
const tester = user('tester', ['report.view'])
// A custom role that was granted the compliance export but nothing else.
const complianceAuditor = user('Compliance Auditor', ['report.view', 'report.compliance_export'])

describe('route access', () => {
  it('Compliance Reports follows the report.compliance_export permission, not the role name', () => {
    expect(canAccessPath(admin, '/reporting/print')).toBe(true)
    expect(canAccessPath(manager, '/reporting/print')).toBe(true)
    expect(canAccessPath(complianceAuditor, '/reporting/print')).toBe(true)
    expect(canAccessPath(tester, '/reporting/print')).toBe(false)
  })

  it('the regular Reports page stays open to everyone who is signed in', () => {
    expect(accessRuleForPath('/reporting')).toBeNull()
    expect(canAccessPath(tester, '/reporting')).toBe(true)
  })

  it('still applies the role levels to the admin screens', () => {
    expect(canAccessPath(admin, '/admin/users')).toBe(true)
    expect(canAccessPath(manager, '/admin/users')).toBe(false)
    expect(canAccessPath(manager, '/admin/environments')).toBe(true)
    expect(canAccessPath(tester, '/admin/environments')).toBe(false)
    expect(canAccessPath(tester, '/settings')).toBe(false)
  })

  it('gates Access Rules by the access_rule.manage permission', () => {
    const ruleAdmin = user('admin', ['tenant.settings.manage', 'access_rule.manage'])
    expect(canAccessPath(ruleAdmin, '/admin/access-rules')).toBe(true)
    expect(canAccessPath(admin, '/admin/access-rules')).toBe(false)
    expect(canAccessPath(manager, '/admin/access-rules')).toBe(false)
    expect(canAccessPath(tester, '/admin/access-rules')).toBe(false)
  })

  it('matches nested paths and ignores a trailing slash', () => {
    expect(canAccessPath(tester, '/reporting/print/')).toBe(false)
    expect(canAccessPath(manager, '/admin/users/123')).toBe(false)
  })

  it('treats a signed-out user as having no access to restricted paths', () => {
    expect(canAccessPath(null, '/reporting/print')).toBe(false)
    expect(canAccessPath(null, '/admin/users')).toBe(false)
  })

  it('hides /reporting from a Tester only when the tenant turned Reports off (ADR-093)', () => {
    const hidden = { ...tester, reports_hidden: true }
    expect(canAccessPath(hidden, '/reporting')).toBe(false)
    expect(canAccessPath(hidden, '/reporting/anything')).toBe(false)
    expect(canAccessPath(hidden, '/projects')).toBe(true)
    expect(canAccessPath(tester, '/reporting')).toBe(true)
  })
})
