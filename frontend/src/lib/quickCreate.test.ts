import { describe, expect, it } from 'vitest'

import type { MeResponse } from '@/api/auth'

import { getQuickCreateActions, projectIdFromPath } from './quickCreate'

function user(role: string, permissions: string[]): MeResponse {
  return { user_id: 'u', tenant_id: 't', email: 'u@example.com', name: 'U', role, permissions }
}

const PID = '3f2a9c1e-1111-4222-8333-444455556666'
const admin = user('admin', ['tenant.settings.manage', 'testcase.create', 'testrun.create'])
const manager = user('manager', ['project.view.all', 'testcase.create', 'testrun.create'])
const tester = user('tester', ['testcase.create'])
const viewer = user('viewer', [])

const kinds = (u: MeResponse | null, pid?: string) => getQuickCreateActions(u, pid).map((a) => a.kind)

describe('quick-create actions', () => {
  it('offers nothing when signed out', () => {
    expect(kinds(null)).toEqual([])
  })

  it('filters by the same permissions the target pages use', () => {
    expect(kinds(admin)).toEqual(['test-case', 'defect', 'project'])
    expect(kinds(tester)).toEqual(['test-case', 'defect'])
    expect(kinds(viewer)).toEqual(['defect'])
  })

  it('offers test runs and requirements only inside a project, and only with permission', () => {
    expect(kinds(manager, PID)).toEqual(['test-case', 'test-run', 'defect', 'project', 'requirement'])
    expect(kinds(tester, PID)).toEqual(['test-case', 'defect'])
  })

  it('targets existing pages with ?action=create', () => {
    const paths = Object.fromEntries(getQuickCreateActions(manager, PID).map((a) => [a.kind, a.path]))
    expect(paths['test-run']).toBe(`/projects/${PID}/test-runs?action=create`)
    expect(paths['project']).toBe('/projects?action=create')
    expect(getQuickCreateActions(manager)[0].path).toBe('/test-repository?action=create')
  })

  it('reads the project id from a project path', () => {
    expect(projectIdFromPath(`/projects/${PID}/test-cases`)).toBe(PID)
    expect(projectIdFromPath('/projects')).toBeUndefined()
    expect(projectIdFromPath('/defects')).toBeUndefined()
  })
})
