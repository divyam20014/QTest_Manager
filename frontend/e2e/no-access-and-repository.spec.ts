import { expect, test, type Page, type Route } from '@playwright/test'

import { API_BASE_URL, bootstrapTenant, loginViaUi } from './fixtures'

// UI/UX follow-ups:
//  - UX-030: a role that may not open an admin URL sees a friendly "No access"
//    screen before any of that screen's data is requested; a 403 on a screen's
//    primary data shows the same message instead of a generic load error.
//  - UX-008: the Test Repository no longer asks every project for its cases on
//    load and no longer renders every project's rows.
// All data is created in throwaway tenants (or mocked) -- nothing shared.

async function fulfillCors(route: Route, json: unknown, status = 200, error: unknown = null) {
  const req = route.request()
  const headers: Record<string, string> = {
    'access-control-allow-origin': req.headers()['origin'] ?? '*',
    'access-control-allow-credentials': 'true',
    'access-control-allow-headers': req.headers()['access-control-request-headers'] ?? '*',
    'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
  }
  if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers })
  return route.fulfill({ status, headers, json: { data: status === 200 ? json : null, error } })
}

const ADMIN_ONLY = ['/admin/users', '/admin/roles', '/admin/audit-logs', '/settings', '/admin']

test('UX-030: Tester and Manager see "No access" for admin URLs, Admin does not', async ({
  page,
  browser,
  request,
}) => {
  const tenant = await bootstrapTenant(request, 'NoAccess')
  const suffix = tenant.tenantId.slice(0, 8)

  // Create a Manager and a Tester as the bootstrap Admin (API, not UI: fast and
  // the user-management screens are covered elsewhere).
  const loginRes = await request.post(`${API_BASE_URL}/auth/login`, {
    data: { tenant_id: tenant.tenantId, email: tenant.adminEmail, password: tenant.adminPassword },
  })
  await request.post(`${API_BASE_URL}/auth/mfa/verify`, { data: { code: (await loginRes.json()).data.debug_code } })
  const people = {
    manager: { email: `manager-${suffix}@example.com`, password: 'ManagerPassw0rd1!' },
    tester: { email: `tester-${suffix}@example.com`, password: 'TesterPassw0rd1!' },
  }
  for (const [role, p] of Object.entries(people)) {
    const res = await request.post(`${API_BASE_URL}/users`, {
      data: { email: p.email, name: `${role} E2E`, role, password: p.password },
    })
    expect(res.ok()).toBeTruthy()
  }

  async function openAs(p: Page, who: { email: string; password: string }) {
    await loginViaUi(p, tenant.tenantId, who.email, who.password)
  }

  // ---- Tester: every restricted URL (including Environments) is blocked.
  await openAs(page, people.tester)
  const refused: string[] = []
  page.on('response', (r) => {
    if (r.status() === 403) refused.push(r.url().replace(API_BASE_URL, ''))
  })
  for (const path of [...ADMIN_ONLY, '/admin/environments']) {
    await page.goto(path)
    await expect(page.getByTestId('no-access'), path).toBeVisible()
    await expect(page.getByRole('heading', { level: 1, name: /don.t have access/i }), path).toBeVisible()
    await expect(page.getByTestId('no-access')).toContainText('Tester')
  }
  // The guard stops the screen before it fires its data requests.
  expect(refused, 'no 403 should be provoked by opening a blocked URL').toEqual([])
  // Sidebar is unchanged: no administration links for a Tester.
  const sidebarLinks = await page.locator('aside nav a').allTextContents()
  for (const label of ['Users & Roles', 'Roles & Permissions', 'Audit Logs', 'Environments', 'Settings']) {
    expect(sidebarLinks.join('|')).not.toContain(label)
  }
  // "Back to Dashboard" works.
  await page.getByRole('link', { name: 'Back to Dashboard' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible()
  // Deep link to an open screen still works.
  await page.goto('/projects')
  await expect(page.getByRole('heading', { level: 1, name: 'Projects' })).toBeVisible()

  // ---- Manager: Environments is open, the other admin screens are blocked.
  const managerCtx = await browser.newContext()
  const managerPage = await managerCtx.newPage()
  await openAs(managerPage, people.manager)
  await managerPage.goto('/admin/environments')
  await expect(managerPage.getByRole('heading', { level: 1, name: 'Environments' })).toBeVisible()
  await expect(managerPage.getByTestId('no-access')).toHaveCount(0)
  for (const path of ADMIN_ONLY) {
    await managerPage.goto(path)
    await expect(managerPage.getByTestId('no-access'), path).toBeVisible()
    await expect(managerPage.getByTestId('no-access')).toContainText('Manager')
  }
  await managerCtx.close()

  // ---- Admin: nothing is blocked.
  const adminCtx = await browser.newContext()
  const adminPage = await adminCtx.newPage()
  await openAs(adminPage, { email: tenant.adminEmail, password: tenant.adminPassword })
  for (const [path, heading] of [
    ['/admin/users', 'Users & Roles'],
    ['/admin/audit-logs', 'Audit Logs'],
    ['/settings', 'Settings'],
  ]) {
    await adminPage.goto(path)
    await expect(adminPage.getByRole('heading', { level: 1, name: heading }), path).toBeVisible()
    await expect(adminPage.getByTestId('no-access')).toHaveCount(0)
  }
  await adminCtx.close()
})

test('UX-030: a 403 from the API on a screen\'s main data shows "No access", not a load error, and is not retried', async ({
  page,
  request,
}) => {
  const tenant = await bootstrapTenant(request, 'Forbidden')
  await loginViaUi(page, tenant.tenantId, tenant.adminEmail, tenant.adminPassword)

  let calls = 0
  await page.route(/\/api\/v1\/defects\/[0-9a-f-]{36}$/, (route) => {
    calls += 1
    return fulfillCors(route, null, 403, { code: 'forbidden', message: 'You do not have permission to do this.' })
  })
  await page.goto('/defects/11111111-1111-1111-1111-111111111111')
  await expect(page.getByText("You don't have access to this", { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Back to Dashboard' }).or(page.getByRole('link', { name: 'Back to Dashboard' }))).toBeVisible()
  await expect(page.getByText("Couldn't load this")).toHaveCount(0)
  // A refusal is final: react-query must not repeat it.
  await page.waitForTimeout(1500)
  expect(calls).toBe(1)
})

// ------------------------------------------------------------------ UX-008

function projectFixture(n: number, count: number) {
  return {
    id: `0000000${n}-0000-0000-0000-000000000000`,
    name: `Project ${n}`,
    domain: 'Motor',
    status: 'On Track',
    priority: 'High',
    manager_name: 'M',
    manager_user_id: null,
    start_date: '2026-01-01',
    end_date: '2026-12-31',
    budget: '1',
    currency_code: 'USD',
    region: 'EMEA',
    owner_id: 'x',
    assigned_user_ids: [],
    created_at: '2026-01-01T00:00:00Z',
    test_case_count: count,
    approved_test_case_count: 0,
    test_run_count: 0,
    open_defect_count: 0,
  }
}

function caseFixture(projectId: string, n: number, title: string) {
  return {
    id: `${projectId.slice(0, 8)}-0000-0000-0000-${String(n).padStart(12, '0')}`,
    project_id: projectId,
    title,
    description: '',
    priority: 'Medium',
    status: 'draft',
    status_label: 'Draft',
    assignee_id: null,
    module_id: null,
    reviewer_id: null,
    reviewer_name: null,
    version_number: 1,
    created_by: 'x',
    created_at: new Date(Date.UTC(2026, 0, 1, 0, 0, n)).toISOString(),
    steps: [],
    custom_fields: {},
    scenario_id: null,
    scenario_description: null,
    prerequisite: null,
    test_data: null,
    last_execution_result: null,
    last_executed_by_name: null,
    last_execution_date: null,
  }
}

test('UX-008: Test Repository only requests and renders the open project group', async ({ page, request }) => {
  const tenant = await bootstrapTenant(request, 'RepoGroups')
  await loginViaUi(page, tenant.tenantId, tenant.adminEmail, tenant.adminPassword)

  const P1 = projectFixture(1, 60)
  const P2 = projectFixture(2, 0) // empty: never requested, no header
  const P3 = projectFixture(3, 5)
  const sizes: Record<string, number> = { [P1.id]: 60, [P3.id]: 5 }
  const requested: { project: string; search: string; sort: string }[] = []

  await page.route(/\/api\/v1\/projects\?.*/, (route) => fulfillCors(route, { items: [P1, P2, P3], total: 3 }))
  await page.route(/\/api\/v1\/projects\/[^/]+\/test-cases(\?.*)?$/, (route) => {
    const url = new URL(route.request().url())
    const id = url.pathname.split('/')[4]
    const search = url.searchParams.get('search') ?? ''
    requested.push({ project: id, search, sort: url.searchParams.get('sort') ?? '' })
    const total = sizes[id] ?? 0
    const pageNo = Number(url.searchParams.get('page') ?? '1')
    const size = Number(url.searchParams.get('page_size') ?? '50')
    const start = (pageNo - 1) * size
    const label = id === P1.id ? 'Alpha' : 'Gamma'
    // Like the API: "-created_at" is newest first (the newest case has the highest number).
    const newestFirst = (url.searchParams.get('sort') ?? '').startsWith('-')
    const items = Array.from({ length: Math.max(0, Math.min(size, total - start)) }, (_, i) => {
      const n = newestFirst ? total - (start + i) : start + i + 1
      return caseFixture(id, n, `${label} case ${String(n).padStart(3, '0')}`)
    }).filter((c) => !search || c.title.toLowerCase().includes(search.toLowerCase()))
    return fulfillCors(route, { items, total: search ? items.length : total })
  })

  // ADR-077: a filter is answered by ONE tenant-wide request (not one per project).
  const requestedAll: { search: string; sort: string; page: number }[] = []
  await page.route(/\/api\/v1\/test-cases(\?.*)?$/, (route) => {
    const url = new URL(route.request().url())
    const search = url.searchParams.get('search') ?? ''
    const pageNo = Number(url.searchParams.get('page') ?? '1')
    requestedAll.push({ search, sort: url.searchParams.get('sort') ?? '', page: pageNo })
    const all = [
      ...Array.from({ length: 60 }, (_, i) => caseFixture(P1.id, 60 - i, `Alpha case ${String(60 - i).padStart(3, '0')}`)),
      ...Array.from({ length: 5 }, (_, i) => caseFixture(P3.id, 5 - i, `Gamma case ${String(5 - i).padStart(3, '0')}`)),
    ].filter((c) => !search || c.title.toLowerCase().includes(search.toLowerCase()))
    const size = Number(url.searchParams.get('page_size') ?? '50')
    const start = (pageNo - 1) * size
    return fulfillCors(route, { items: all.slice(start, start + size), total: all.length })
  })

  await page.goto('/test-repository')
  // Group headers for the two non-empty projects (counts come from the project list);
  // the empty project has no header and is never requested.
  const group1 = page.getByRole('button', { name: /Project 1/ })
  const group3 = page.getByRole('button', { name: /Project 3/ })
  await expect(group1).toBeVisible()
  await expect(group1).toContainText('60 test cases')
  await expect(group3).toContainText('5 test cases')
  await expect(page.getByRole('button', { name: /Project 2/ })).toHaveCount(0)
  await expect(group1).toHaveAttribute('aria-expanded', 'true')
  await expect(group3).toHaveAttribute('aria-expanded', 'false')

  // Only the first group was fetched and rendered (50 of 60), newest first.
  await expect(page.getByText('Alpha case 060').first()).toBeVisible({ timeout: 15000 })
  expect(new Set(requested.map((r) => r.project))).toEqual(new Set([P1.id]))
  expect(requested.every((r) => r.sort === '-created_at')).toBeTruthy()
  await expect(page.locator('table tbody tr')).toHaveCount(50)
  await expect(page.getByText(/50 test cases shown from 1 of 2 projects · 10 more in the open projects/)).toBeVisible()

  // Opening the second group fetches it (and only it).
  await group3.click()
  await expect(group3).toHaveAttribute('aria-expanded', 'true')
  await expect(page.getByText('Gamma case 005').first()).toBeVisible()
  expect(new Set(requested.map((r) => r.project))).toEqual(new Set([P1.id, P3.id]))
  await expect(page.locator('table tbody tr')).toHaveCount(55)

  // Select all is scoped to its own group.
  const tables = page.getByRole('table')
  await tables.nth(1).getByRole('checkbox', { name: 'Select all' }).check()
  await expect(page.getByText('5 selected', { exact: true })).toBeVisible()
  await expect(tables.nth(0).getByRole('checkbox', { name: 'Select all' })).not.toBeChecked()

  // Collapsing a group drops its rows and its selection.
  await group3.click()
  await expect(page.locator('table tbody tr')).toHaveCount(50)
  await expect(page.getByText(/\d+ selected/)).toHaveCount(0)

  // Load more still works on the open group.
  await page.getByRole('button', { name: /Load more \(10 remaining\)/ }).click()
  await expect(page.locator('table tbody tr')).toHaveCount(60)

  // Searching is debounced (one request, not one per keystroke) and ONE tenant-wide
  // request answers it -- the projects are not asked one by one any more.
  const projectRequestsBefore = requested.length
  await page.locator('#repo-search').pressSequentially('gamma', { delay: 40 })
  await expect(page.getByText('Gamma case 005').first()).toBeVisible()
  expect(requested.length, 'no per-project request while a filter is on').toBe(projectRequestsBefore)
  expect(requestedAll).toEqual([{ search: 'gamma', sort: '-created_at', page: 1 }])
  // The results are one flat list (no group headers) with a Project column.
  await expect(page.getByRole('button', { name: /Project 1/ })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /Project 3/ })).toHaveCount(0)
  await expect(page.locator('table tbody tr')).toHaveCount(5)
  await expect(page.getByRole('columnheader', { name: 'Project' })).toBeVisible()
  await expect(page.getByText(/5 test cases shown \(all matching\) across all projects/)).toBeVisible()
  // Clearing the filter returns to the grouped view.
  await page.locator('#repo-search').fill('')
  await expect(page.getByRole('button', { name: /Project 1/ })).toBeVisible()
})
