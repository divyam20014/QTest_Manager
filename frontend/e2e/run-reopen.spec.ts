import { expect, test, type Page } from '@playwright/test'

import { API_BASE_URL, bootstrapTenant, loginViaUi } from './fixtures'

// ADR-075: blocking the last open case auto-finishes a run, which used to lock
// the blocked case for good. "Reopen Run" undoes the finish. Runs against its
// own throwaway tenant.

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

test('Reopen Run: a run finished by blocking its last case can be reopened and the case unblocked', async ({
  page,
  request,
}) => {
  const tenant = await bootstrapTenant(request, 'RunReopen')
  await loginViaUi(page, tenant.tenantId, tenant.adminEmail, tenant.adminPassword)

  const me = (await get(page, '/auth/me')) as { user_id: string }
  const project = await post(page, '/projects', {
    name: 'Reopen Motor Claims',
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
  const created = await post(page, `/projects/${project.id}/test-cases`, {
    title: 'Verify salvage valuation',
    priority: 'High',
    steps: [{ action: 'Open the claim', expected: 'The claim opens' }],
  })
  await post(page, `/test-cases/${created.id}/submit-review`, {})
  await post(page, `/test-cases/${created.id}/approve`)
  const run = await post(page, `/projects/${project.id}/test-runs`, {
    name: 'Reopen Run',
    run_type: 'Regression',
    test_case_ids: [created.id],
  })

  // Blocking the only case finishes the run.
  const runCaseId = run.cases[0].id as string
  await post(page, `/test-run-cases/${runCaseId}/block`, { reason: 'No build available' })
  expect((await get(page, `/test-runs/${run.id}`)).finished_at).not.toBeNull()

  await page.goto(`/test-runs/${run.id}`)
  await expect(page.getByText('Finished', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Finish Run' })).toHaveCount(0)

  await page.getByRole('button', { name: 'Reopen Run' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByText('Reopen this run?')).toBeVisible()
  await dialog.getByRole('button', { name: 'Reopen run' }).click()

  await expect(page.getByText('Active', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Reopen Run' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Finish Run' })).toBeVisible()

  const reopened = await get(page, `/test-runs/${run.id}`)
  expect(reopened.finished_at).toBeNull()
  expect(reopened.cases[0].status).toBe('blocked')

  // The blocked case can be unblocked again.
  await post(page, `/test-run-cases/${runCaseId}/unblock`)
  expect((await get(page, `/test-runs/${run.id}`)).cases[0].status).not.toBe('blocked')
})
