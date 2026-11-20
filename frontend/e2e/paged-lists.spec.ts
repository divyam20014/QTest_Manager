import { expect, test, type Page } from '@playwright/test'

import { API_BASE_URL, bootstrapTenant, loginViaUi } from './fixtures'

// ADR-078: the Defects list and the Test Runs overview are paged by the server, so only
// one page is downloaded however many rows exist; the status tabs get their counts from a
// separate endpoint. Real backend, own throwaway tenant.

async function post(page: Page, path: string, data?: unknown) {
  const response = await page.request.post(`${API_BASE_URL}${path}`, { data })
  if (!response.ok()) throw new Error(`POST ${path} failed (${response.status()}): ${await response.text()}`)
  return (await response.json()).data
}

test('Defects: one page at a time, tab counts from the server, page 2 and a status tab work', async ({
  page,
  request,
}) => {
  test.setTimeout(180_000)
  const tenant = await bootstrapTenant(request, 'PagedDefects')
  await loginViaUi(page, tenant.tenantId, tenant.adminEmail, tenant.adminPassword)
  const me = (await (await page.request.get(`${API_BASE_URL}/auth/me`)).json()).data as { user_id: string }
  const project = await post(page, '/projects', {
    name: 'Paged Claims',
    domain: 'Motor',
    priority: 'High',
    manager_name: 'Jane Manager',
    start_date: '2026-01-01',
    end_date: '2026-12-31',
    budget: '1000.00',
    region: 'North America',
  })
  if (!project.assigned_user_ids.includes(me.user_id)) {
    await post(page, `/projects/${project.id}/members`, { user_id: me.user_id })
  }
  const ids: string[] = []
  for (let i = 1; i <= 53; i++) {
    const defect = await post(page, '/defects', {
      project_id: project.id,
      title: `Paged defect ${String(i).padStart(2, '0')}`,
      severity: 'Medium',
      description: 'Created by the paging test',
    })
    ids.push(defect.id as string)
  }
  // Move three of them to Open so the tabs have different counts.
  for (const id of ids.slice(0, 3)) {
    const res = await page.request.patch(`${API_BASE_URL}/defects/${id}/status`, { data: { status: 'Open' } })
    expect(res.ok()).toBeTruthy()
  }

  const listRequests: URL[] = []
  const countRequests: URL[] = []
  page.on('request', (r) => {
    const url = new URL(r.url())
    if (url.pathname === '/api/v1/defects') listRequests.push(url)
    if (url.pathname === '/api/v1/defects/status-counts') countRequests.push(url)
  })

  await page.goto('/defects')
  // Only one page of rows (50 of 53), newest first, and the server's total in the pager.
  await expect(page.locator('table tbody tr')).toHaveCount(50)
  await expect(page.getByText('Page 1 of 2 (53 defects)')).toBeVisible()
  expect(listRequests.every((u) => u.searchParams.get('page_size') === '50')).toBeTruthy()
  expect(listRequests.every((u) => u.searchParams.get('page') === '1')).toBeTruthy()
  // Tab counts come from the counts endpoint, not from the rows on screen.
  await expect(page.getByRole('tab', { name: /^All\s*53/ })).toBeVisible()
  await expect(page.getByRole('tab', { name: /^New\s*50/ })).toBeVisible()
  await expect(page.getByRole('tab', { name: /^Open\s*3/ })).toBeVisible()
  expect(countRequests.length).toBeGreaterThan(0)

  // Page 2 holds the remaining three (the oldest).
  await page.getByRole('button', { name: 'Next' }).click()
  await expect(page.getByText('Page 2 of 2 (53 defects)')).toBeVisible()
  await expect(page.locator('table tbody tr')).toHaveCount(3)
  expect(listRequests.some((u) => u.searchParams.get('page') === '2')).toBeTruthy()

  // A status tab asks the server for that status and starts again from page 1.
  // (Page 2 also has 3 rows, so wait for the request itself, not just the row count.)
  await page.getByRole('tab', { name: /^Open/ }).click()
  await expect
    .poll(() => listRequests.some((u) => u.searchParams.get('status') === 'Open'))
    .toBeTruthy()
  const openRequest = listRequests.find((u) => u.searchParams.get('status') === 'Open')!
  expect(openRequest.searchParams.get('page')).toBe('1')
  await expect(page.getByRole('tab', { name: /^Open/ })).toHaveAttribute('aria-selected', 'true')
  await expect(page.locator('table tbody tr')).toHaveCount(3)
  await expect(page.getByText(/Page \d+ of/)).toHaveCount(0)
})

test('Test Runs overview: one request for a page of runs across projects', async ({ page, request }) => {
  test.setTimeout(240_000)
  const tenant = await bootstrapTenant(request, 'PagedRuns')
  await loginViaUi(page, tenant.tenantId, tenant.adminEmail, tenant.adminPassword)
  const me = (await (await page.request.get(`${API_BASE_URL}/auth/me`)).json()).data as { user_id: string }

  const caseIds: string[] = []
  const projectIds: string[] = []
  for (const name of ['Paged Runs Alpha', 'Paged Runs Beta']) {
    const project = await post(page, '/projects', {
      name,
      domain: 'Motor',
      priority: 'High',
      manager_name: 'Jane Manager',
      start_date: '2026-01-01',
      end_date: '2026-12-31',
      budget: '1000.00',
      region: 'North America',
    })
    if (!project.assigned_user_ids.includes(me.user_id)) {
      await post(page, `/projects/${project.id}/members`, { user_id: me.user_id })
    }
    const created = await post(page, `/projects/${project.id}/test-cases`, {
      title: `Verify ${name}`,
      priority: 'High',
      steps: [{ action: 'Open', expected: 'Opens' }],
    })
    await post(page, `/test-cases/${created.id}/submit-review`, {})
    await post(page, `/test-cases/${created.id}/approve`)
    projectIds.push(project.id as string)
    caseIds.push(created.id as string)
  }
  // 52 runs split across the two projects.
  for (let i = 1; i <= 52; i++) {
    const k = i % 2
    await post(page, `/projects/${projectIds[k]}/test-runs`, {
      name: `Paged run ${String(i).padStart(2, '0')}`,
      run_type: 'Regression',
      test_case_ids: [caseIds[k]],
    })
  }

  const overview: URL[] = []
  const perProject: string[] = []
  page.on('request', (r) => {
    const url = new URL(r.url())
    if (url.pathname === '/api/v1/test-runs') overview.push(url)
    if (/\/api\/v1\/projects\/[^/]+\/test-runs$/.test(url.pathname)) perProject.push(url.pathname)
  })

  await page.goto('/test-runs')
  await expect(page.locator('table tbody tr')).toHaveCount(50)
  await expect(page.getByText('Page 1 of 2 (52 runs)')).toBeVisible()
  // The newest run is first and both projects appear (names resolved from the project list).
  await expect(page.locator('table tbody tr').first()).toContainText('Paged run 52')
  await expect(page.locator('table tbody').getByText('Paged Runs Alpha').first()).toBeVisible()
  await expect(page.locator('table tbody').getByText('Paged Runs Beta').first()).toBeVisible()
  // One overview request for the page; the projects were not asked one by one.
  expect(overview).toHaveLength(1)
  expect(overview[0].searchParams.get('page_size')).toBe('50')
  expect(perProject).toEqual([])

  await page.getByRole('button', { name: 'Next' }).click()
  await expect(page.getByText('Page 2 of 2 (52 runs)')).toBeVisible()
  await expect(page.locator('table tbody tr')).toHaveCount(2)
})
