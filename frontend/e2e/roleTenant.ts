import { expect, type APIRequestContext } from '@playwright/test'

import { API_BASE_URL, bootstrapTenant, type SeededTenant } from './fixtures'

// Shared throwaway-tenant seeding for the per-role specs (a11y sweep, Manager
// and Tester browser flows): a fresh tenant with an Admin, a Manager and a
// Tester, plus one project both are members of, with an approved test case, a
// run and a failed step + defect so detail screens have real data behind them.
// Everything goes through the API as the bootstrap Admin; the tenant is
// throwaway (bootstrapTenant) and nothing shared is touched.

export interface Person {
  email: string
  password: string
  id: string
}

export interface RoleTenant extends SeededTenant {
  manager: Person
  tester: Person
  projectId?: string
  caseId?: string
  runId?: string
  runCaseId?: string
  defectId?: string
}

export async function seedRoleTenant(
  request: APIRequestContext,
  prefix: string,
  opts: { withData?: boolean } = {},
): Promise<RoleTenant> {
  const tenant = await bootstrapTenant(request, prefix)
  const suffix = tenant.tenantId.slice(0, 8)
  const login = await request.post(`${API_BASE_URL}/auth/login`, {
    data: { tenant_id: tenant.tenantId, email: tenant.adminEmail, password: tenant.adminPassword },
  })
  expect(login.ok(), await login.text()).toBeTruthy()
  const verify = await request.post(`${API_BASE_URL}/auth/mfa/verify`, {
    data: { code: (await login.json()).data.debug_code },
  })
  expect(verify.ok(), await verify.text()).toBeTruthy()

  const mk = async (role: 'manager' | 'tester', password: string): Promise<Person> => {
    const email = `${role}-${suffix}@example.com`
    const res = await request.post(`${API_BASE_URL}/users`, {
      data: { email, name: `${role[0].toUpperCase()}${role.slice(1)} E2E`, role, password },
    })
    expect(res.ok(), await res.text()).toBeTruthy()
    return { email, password, id: (await res.json()).data.id }
  }
  const out: RoleTenant = {
    ...tenant,
    manager: await mk('manager', 'ManagerPassw0rd1!'),
    tester: await mk('tester', 'TesterPassw0rd1!'),
  }

  if (opts.withData) {
    const post = async (path: string, data?: unknown) => {
      const res = await request.post(`${API_BASE_URL}${path}`, { data })
      expect(res.ok(), `${path}: ${await res.text()}`).toBeTruthy()
      return (await res.json()).data
    }
    const project = await post('/projects', {
      name: 'Apex Motor Claims',
      domain: 'Motor',
      priority: 'High',
      manager_name: 'Jane Manager',
      start_date: '2026-01-01',
      end_date: '2026-12-31',
      budget: '450000.00',
      region: 'North America',
    })
    out.projectId = project.id
    for (const p of [out.manager, out.tester]) {
      await post(`/projects/${project.id}/members`, { user_id: p.id })
    }
    const tc = await post(`/projects/${project.id}/test-cases`, {
      title: 'Verify settlement',
      priority: 'High',
      steps: [
        { action: 'Open the claim', expected: 'Claim opens' },
        { action: 'Settle the claim', expected: 'Settlement posted' },
      ],
    })
    await post(`/test-cases/${tc.id}/submit-review`, {})
    await post(`/test-cases/${tc.id}/approve`)
    out.caseId = tc.id
    const run = await post(`/projects/${project.id}/test-runs`, {
      name: 'Sprint run',
      run_type: 'Smoke',
      test_case_ids: [tc.id],
    })
    out.runId = run.id
    out.runCaseId = run.cases[0].id
    const stepsRes = await request.get(`${API_BASE_URL}/test-run-cases/${out.runCaseId}/steps`)
    const steps = (await stepsRes.json()).data
    await post(`/execution-steps/${steps[0].id}/verdict`, { verdict: 'fail' })
    const defect = await post('/defects', { execution_step_id: steps[0].id, severity: 'High' })
    out.defectId = defect.id
  }
  await request.post(`${API_BASE_URL}/auth/logout`)
  return out
}
