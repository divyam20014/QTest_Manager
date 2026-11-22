import { expect, test, type Page } from '@playwright/test'

import { API_BASE_URL, bootstrapTenant, loginViaUi } from './fixtures'

// ADR-077: with a filter on and no project chosen, the Test Repository asks the
// tenant-wide listing once instead of asking every project. Real backend, own tenant.

async function post(page: Page, path: string, data?: unknown) {
  const response = await page.request.post(`${API_BASE_URL}${path}`, { data })
  if (!response.ok()) throw new Error(`POST ${path} failed (${response.status()}): ${await response.text()}`)
  return (await response.json()).data
}

async function project(page: Page, name: string, userId: string) {
  const created = await post(page, '/projects', {
    name,
    domain: 'Motor',
    priority: 'High',
    manager_name: 'Jane Manager',
    start_date: '2026-01-01',
    end_date: '2026-12-31',
    budget: '1000.00',
    region: 'North America',
  })
  if (!created.assigned_user_ids.includes(userId)) {
    await post(page, `/projects/${created.id}/members`, { user_id: userId })
  }
  return created.id as string
}

async function testCase(page: Page, projectId: string, title: string) {
  const created = await post(page, `/projects/${projectId}/test-cases`, {
    title,
    priority: 'High',
    steps: [{ action: 'Open', expected: 'Opens' }],
  })
  await post(page, `/test-cases/${created.id}/submit-review`, {})
  await post(page, `/test-cases/${created.id}/approve`)
}

test('a filter is answered by one tenant-wide request across projects', async ({ page, request }) => {
  const tenant = await bootstrapTenant(request, 'RepoUnified')
  await loginViaUi(page, tenant.tenantId, tenant.adminEmail, tenant.adminPassword)
  const me = (await (await page.request.get(`${API_BASE_URL}/auth/me`)).json()).data as { user_id: string }

  const motor = await project(page, 'Motor Claims Alpha', me.user_id)
  const health = await project(page, 'Health Claims Beta', me.user_id)
  const travel = await project(page, 'Travel Claims Gamma', me.user_id)
  await testCase(page, motor, 'Verify salvage valuation (motor)')
  await testCase(page, motor, 'Verify total loss settlement')
  await testCase(page, health, 'Verify salvage recovery (health)')
  await testCase(page, travel, 'Verify baggage delay cover')

  const projectScoped: string[] = []
  const tenantWide: string[] = []
  page.on('request', (r) => {
    const url = new URL(r.url())
    // The one-row status-tab count requests are not part of the listing fan-out under test.
    if (url.searchParams.get('page_size') === '1') return
    if (/\/api\/v1\/projects\/[^/]+\/test-cases$/.test(url.pathname)) projectScoped.push(url.search)
    if (url.pathname === '/api/v1/test-cases') tenantWide.push(url.search)
  })

  await page.goto('/test-repository')
  await expect(page.getByRole('button', { name: /Motor Claims Alpha/ })).toBeVisible()
  const groupedRequests = projectScoped.length
  expect(groupedRequests, 'unfiltered view loads only the open group').toBe(1)
  expect(tenantWide).toHaveLength(0)

  await page.locator('#repo-search').fill('salvage')
  await expect(page.locator('table tbody tr')).toHaveCount(2)
  await expect(page.getByText('Verify salvage valuation (motor)')).toBeVisible()
  await expect(page.getByText('Verify salvage recovery (health)')).toBeVisible()
  // Cases from different projects, one flat list, the Project column says which.
  await expect(page.getByRole('columnheader', { name: 'Project' })).toBeVisible()
  await expect(page.getByRole('cell', { name: 'Motor Claims Alpha' })).toBeVisible()
  await expect(page.getByRole('cell', { name: 'Health Claims Beta' })).toBeVisible()
  // ONE tenant-wide request; the three projects were not asked one by one.
  expect(tenantWide).toHaveLength(1)
  expect(tenantWide[0]).toContain('search=salvage')
  expect(projectScoped.length, 'no per-project request while the filter is on').toBe(groupedRequests)
})
