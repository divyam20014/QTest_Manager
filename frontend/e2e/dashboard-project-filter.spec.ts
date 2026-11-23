import { expect, test, type Page, type Request } from '@playwright/test'

import { API_BASE_URL, bootstrapTenant, loginViaUi, seedDefectBody, seedCaseBody } from './fixtures'

// ADR-079: the Dashboard can be narrowed to one project, and every one of its data sources
// follows. The choice lives in the URL. Real backend, own throwaway tenant.

async function post(page: Page, path: string, data?: unknown) {
  const response = await page.request.post(`${API_BASE_URL}${path}`, { data })
  if (!response.ok()) throw new Error(`POST ${path} failed (${response.status()}): ${await response.text()}`)
  return (await response.json()).data
}

async function project(page: Page, name: string, userId: string, cases: number) {
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
  for (let i = 1; i <= cases; i++) {
    const tc = await post(page, `/projects/${created.id}/test-cases`, await seedCaseBody(page.request, created.id, {
      title: `${name} case ${i}`,
      priority: 'High',
      steps: [{ action: 'Open', expected: 'Opens' }],
    }))
    await post(page, `/test-cases/${tc.id}/submit-review`, {})
    await post(page, `/test-cases/${tc.id}/approve`)
  }
  await post(page, '/defects', seedDefectBody(created.id, { title: `${name} defect`, description: 'Dashboard filter test' }))
  return created.id as string
}

const DASHBOARD_PATHS = [
  '/api/v1/dashboard/summary',
  '/api/v1/dashboard/activity-stream',
  '/api/v1/reports/execution-trend',
  '/api/v1/reports/aggregate',
  '/api/v1/defects',
]

test('the Dashboard narrows to one project: every data source, the URL, reload and a stale id', async ({
  page,
  request,
}) => {
  test.setTimeout(180_000)
  const tenant = await bootstrapTenant(request, 'DashProject')
  await loginViaUi(page, tenant.tenantId, tenant.adminEmail, tenant.adminPassword)
  const me = (await (await page.request.get(`${API_BASE_URL}/auth/me`)).json()).data as { user_id: string }
  const alpha = await project(page, 'Alpha Motor Claims', me.user_id, 2)
  const beta = await project(page, 'Beta Health Claims', me.user_id, 1)

  const dashboardRequests: URL[] = []
  const onRequest = (r: Request) => {
    const url = new URL(r.url())
    if (DASHBOARD_PATHS.includes(url.pathname)) dashboardRequests.push(url)
  }
  page.on('request', onRequest)

  const summaryFor = async (action: () => Promise<unknown>, projectId: string | null) => {
    const [response] = await Promise.all([
      page.waitForResponse((r) => {
        const url = new URL(r.url())
        return (
          url.pathname === '/api/v1/dashboard/summary' &&
          (url.searchParams.get('project_id') ?? null) === projectId
        )
      }),
      action(),
    ])
    return (await response.json()).data as { test_cases: { total: number }; projects: { total: number } }
  }

  // Everything: both projects' cases.
  const all = await summaryFor(() => page.goto('/'), null)
  expect(all.test_cases.total).toBe(3)
  expect(all.projects.total).toBe(2)
  await expect(page.getByText('Current testing status and project health at a glance.')).toBeVisible()
  const select = page.locator('#dashboard-project')
  await expect(select).toHaveValue('')

  // Choose Beta: the summary narrows, the URL records it, the description says so.
  dashboardRequests.length = 0
  const beta1 = await summaryFor(() => select.selectOption({ label: 'Beta Health Claims' }), beta)
  expect(beta1.test_cases.total).toBe(1)
  expect(beta1.projects.total).toBe(1)
  await expect(page).toHaveURL(new RegExp(`[?&]project=${beta}`))
  await expect(page.getByText('Current testing status for Beta Health Claims.')).toBeVisible()
  // All five data sources asked for this project only.
  await expect
    .poll(() => DASHBOARD_PATHS.every((p) => dashboardRequests.some((u) => u.pathname === p)))
    .toBeTruthy()
  for (const url of dashboardRequests) {
    expect(url.searchParams.get('project_id'), url.pathname).toBe(beta)
  }

  // A reload keeps the choice, and the first requests already carry it.
  dashboardRequests.length = 0
  const afterReload = await summaryFor(() => page.reload(), beta)
  expect(afterReload.test_cases.total).toBe(1)
  await expect(select).toHaveValue(beta)
  expect(dashboardRequests.every((u) => u.searchParams.get('project_id') === beta)).toBeTruthy()

  // Switching to Alpha, then back to everything.
  const alpha1 = await summaryFor(() => select.selectOption({ label: 'Alpha Motor Claims' }), alpha)
  expect(alpha1.test_cases.total).toBe(2)
  const back = await summaryFor(() => select.selectOption({ label: 'All projects' }), null)
  expect(back.test_cases.total).toBe(3)
  await expect(page).not.toHaveURL(/project=/)

  // An id that is not one of the caller's projects is ignored once the list loads.
  await page.goto('/?project=00000000-0000-0000-0000-000000000000')
  await expect(select).toHaveValue('')
  await expect(page.getByText('Current testing status and project health at a glance.')).toBeVisible()
  page.off('request', onRequest)
})
