import { expect, test, type Page } from '@playwright/test'

import { API_BASE_URL, bootstrapTenant, loginViaUi } from './fixtures'

// ADR-075: the step timer does not run while a case is blocked.

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

test('A blocked case shows "Timer paused while blocked" instead of a running clock', async ({
  page,
  request,
}) => {
  const tenant = await bootstrapTenant(request, 'BlockTimer')
  await loginViaUi(page, tenant.tenantId, tenant.adminEmail, tenant.adminPassword)
  const me = (await get(page, '/auth/me')) as { user_id: string }
  const project = await post(page, '/projects', {
    name: 'Timer Motor Claims',
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
  const caseIds: string[] = []
  for (const title of ['Verify salvage valuation', 'Verify total loss settlement']) {
    const created = await post(page, `/projects/${project.id}/test-cases`, {
      title,
      priority: 'High',
      steps: [{ action: `Open ${title}`, expected: 'It opens' }],
    })
    await post(page, `/test-cases/${created.id}/submit-review`, {})
    await post(page, `/test-cases/${created.id}/approve`)
    caseIds.push(created.id)
  }
  const run = await post(page, `/projects/${project.id}/test-runs`, {
    name: 'Timer Run',
    run_type: 'Regression',
    test_case_ids: caseIds,
  })
  const runCaseId = run.cases[0].id as string

  // Open the first step (starts its timer), then block the case.
  await page.goto(`/test-run-cases/${runCaseId}?runId=${run.id}`)
  await expect(page.getByText(/elapsed/)).toBeVisible()
  await post(page, `/test-run-cases/${runCaseId}/block`, { reason: 'Environment down' })

  await page.reload()
  await expect(page.getByText('This test case is blocked')).toBeVisible()
  await expect(page.getByText('Timer paused while blocked')).toBeVisible()
  await expect(page.getByText(/elapsed/)).toHaveCount(0)

  await post(page, `/test-run-cases/${runCaseId}/unblock`)
  await page.reload()
  await expect(page.getByText(/elapsed/)).toBeVisible()
  await expect(page.getByText('Timer paused while blocked')).toHaveCount(0)
})
