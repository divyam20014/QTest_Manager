import { expect, test, type Page } from '@playwright/test'

import { API_BASE_URL, bootstrapTenant, loginViaUi, seedCaseBody } from './fixtures'

// A failed case keeps its run open so the failed step can be re-run after the
// fix (ADR-070). The run page explains why the run is still active.

async function post(page: Page, path: string, data?: unknown) {
  const response = await page.request.post(`${API_BASE_URL}${path}`, { data })
  if (!response.ok()) throw new Error(`POST ${path} failed (${response.status()}): ${await response.text()}`)
  return (await response.json()).data
}

async function get(page: Page, path: string) {
  const response = await page.request.get(`${API_BASE_URL}${path}`)
  if (!response.ok()) throw new Error(`GET ${path} failed (${response.status()}): ${await response.text()}`)
  return (await response.json()).data
}

test('A run held open by a failed case says why, and finishes once the step is re-run and passes', async ({
  page,
  request,
}) => {
  const tenant = await bootstrapTenant(request, 'RunHeldOpen')
  await loginViaUi(page, tenant.tenantId, tenant.adminEmail, tenant.adminPassword)
  const me = (await get(page, '/auth/me')) as { user_id: string }
  const project = await post(page, '/projects', {
    name: 'Held Open Motor Claims',
    domain: 'Motor',
    priority: 'High',
    manager_name: 'Jane Manager',
    start_date: '2026-01-01',
    end_date: '2026-12-31',
    budget: '450000.00',
    region: 'North America',
  })
  if (!project.assigned_user_ids.includes(me.user_id)) {
    await post(page, `/projects/${project.id}/members`, { user_id: me.user_id })
  }
  const created = await post(
    page,
    `/projects/${project.id}/test-cases`,
    await seedCaseBody(page.request, project.id, {
      title: 'Verify salvage valuation',
      priority: 'High',
      steps: [{ action: 'Open the claim', expected: 'The claim opens' }],
    }),
  )
  await post(page, `/test-cases/${created.id}/submit-review`, {})
  await post(page, `/test-cases/${created.id}/approve`)
  const run = await post(page, `/projects/${project.id}/test-runs`, {
    name: 'Held Open Run',
    run_type: 'Regression',
    test_case_ids: [created.id],
  })
  const runCaseId = run.cases[0].id as string
  const steps = (await get(page, `/test-run-cases/${runCaseId}/steps`)) as { id: string }[]

  // A pending case: no hint yet.
  await page.goto(`/test-runs/${run.id}`)
  await expect(page.getByText('Finish Run')).toBeVisible()
  await expect(page.getByText(/Every case has results/)).toHaveCount(0)

  // Fail the only step: everything is recorded, one case failed -> the run stays open and says why.
  await post(page, `/execution-steps/${steps[0].id}/verdict`, { verdict: 'fail', actual_result: 'The claim did not open' })
  await page.reload()
  await expect(page.getByText('Every case has results, but 1 case failed.')).toBeVisible()
  await expect(page.getByText(/stays open so failed steps can be re-run/)).toBeVisible()
  expect((await get(page, `/test-runs/${run.id}`)).finished_at).toBeNull()

  // Re-run after the fix: the step passes, the case passes, the run finishes and the hint goes.
  await post(page, `/execution-steps/${steps[0].id}/verdict`, { verdict: 'pass' })
  await page.reload()
  await expect(page.getByText(/Every case has results/)).toHaveCount(0)
  await expect(page.getByText('Finished', { exact: true })).toBeVisible()
})
