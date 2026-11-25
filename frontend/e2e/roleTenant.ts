import { expect, type APIRequestContext } from '@playwright/test'

import { API_BASE_URL, bootstrapTenant, type SeededTenant, seedDefectBody } from './fixtures'

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
  requirementId?: string
  /** ADR-127: a top-level task with a sub-task, a requirement and the defect below. */
  taskId?: string
  subTaskId?: string
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
    // ADR-116: the API requires a module, preconditions, test data and an expected result on create.
    const mod = await post(`/projects/${project.id}/modules`, { name: 'Claims' })
    const tc = await post(`/projects/${project.id}/test-cases`, {
      title: 'Verify settlement',
      priority: 'High',
      module_id: mod.id,
      preconditions: 'The claim exists',
      test_data: 'claim=C-100',
      expected_result: 'The settlement is posted',
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
    await post(`/execution-steps/${steps[0].id}/verdict`, { verdict: 'fail', actual_result: 'Settlement was not posted' })
    const defect = await post('/defects', seedDefectBody(undefined, { execution_step_id: steps[0].id }))
    out.defectId = defect.id
    // ADR-127: a task with a sub-task; the requirement, the test case and the defect belong to it.
    const task = await post(`/projects/${project.id}/tasks`, {
      title: 'Settlement engine',
      description: 'Everything about settling a claim',
      assignee_id: out.tester.id,
      due_date: '2026-12-01',
    })
    const sub = await post(`/projects/${project.id}/tasks`, {
      title: 'Rounding rules',
      parent_task_id: task.id,
      due_date: '2026-11-15',
    })
    const requirement = await post(`/projects/${project.id}/requirements`, {
      title: 'Settlement is rounded to the cent',
      description: 'Per the claims handbook',
      task_id: task.id,
    })
    await post(`/requirements/${requirement.id}/test-cases`, { test_case_id: tc.id })
    await request.patch(`${API_BASE_URL}/defects/${defect.id}`, { data: { task_id: sub.id } })
    out.taskId = task.id
    out.subTaskId = sub.id
    out.requirementId = requirement.id
  }
  await request.post(`${API_BASE_URL}/auth/logout`)
  return out
}
