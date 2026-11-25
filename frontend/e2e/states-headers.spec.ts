import { expect, test, type Page } from '@playwright/test'

import { axeFindings, formatFindings } from './a11y'
import { API_BASE_URL, loginViaUi } from './fixtures'
import { seedRoleTenant, type RoleTenant } from './roleTenant'

// ADR-107: shared page header / empty / error / loading states, in a throwaway
// tenant that starts with no data at all.

test.describe.configure({ mode: 'serial' })

let t: RoleTenant
let projectId = ''
let viewer = { email: '', password: '' }

test.beforeAll(async ({ request }) => {
  t = await seedRoleTenant(request, 'states')
})

const admin = (page: Page) => loginViaUi(page, t.tenantId, t.adminEmail, t.adminPassword)
const tester = (page: Page) => loginViaUi(page, t.tenantId, t.tester.email, t.tester.password)
const noOverflow = async (page: Page) =>
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth),
  ).toBeLessThanOrEqual(0)

test('projects: title, empty state with action for Admin, none for Tester', async ({ page }) => {
  await admin(page)
  await page.goto('/projects')
  await expect(page.getByRole('heading', { level: 1, name: 'Projects' })).toBeVisible()
  await expect(page.getByText('No projects yet')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Create your first project' })).toBeVisible()
  await page.screenshot({ path: 'test-results/states-empty-1280.png' })
  await page.context().clearCookies()
  await tester(page)
  await page.goto('/projects')
  await expect(page.getByText('No projects yet')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Create your first project' })).toHaveCount(0)
})

test('create an empty project for the project pages', async ({ request }) => {
  const login = await request.post(`${API_BASE_URL}/auth/login`, {
    data: { tenant_id: t.tenantId, email: t.adminEmail, password: t.adminPassword },
  })
  expect(login.ok()).toBeTruthy()
  const verify = await request.post(`${API_BASE_URL}/auth/mfa/verify`, {
    data: { code: (await login.json()).data.debug_code },
  })
  expect(verify.ok()).toBeTruthy()
  const res = await request.post(`${API_BASE_URL}/projects`, {
    data: {
      name: 'Empty Project',
      domain: 'Motor',
      priority: 'High',
      manager_name: 'Jane Manager',
      start_date: '2026-01-01',
      end_date: '2026-12-31',
      budget: '1000.00',
      region: 'North America',
    },
  })
  expect(res.ok(), await res.text()).toBeTruthy()
  projectId = (await res.json()).data.id
  const role = await request.post(`${API_BASE_URL}/roles`, { data: { name: 'Read only', permission_codes: [] } })
  expect(role.ok(), await role.text()).toBeTruthy()
  const suffix = t.tenantId.slice(0, 8)
  viewer = { email: `viewer-${suffix}@example.com`, password: 'ViewerPassw0rd1!' }
  const u = await request.post(`${API_BASE_URL}/users`, {
    data: { email: viewer.email, name: 'Viewer E2E', role_id: (await role.json()).data.id, password: viewer.password },
  })
  expect(u.ok(), await u.text()).toBeTruthy()
  const m = await request.post(`${API_BASE_URL}/projects/${projectId}/members`, {
    data: { user_id: (await u.json()).data.id },
  })
  expect(m.ok(), await m.text()).toBeTruthy()
})

test('test cases: empty with action (Admin), no action (Tester), filtered variant clears', async ({ page }) => {
  await admin(page)
  await page.goto(`/projects/${projectId}/test-cases`)
  await expect(page.getByRole('heading', { level: 1, name: 'Test Cases' })).toBeVisible()
  await expect(page.getByText('No test cases yet')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Create your first test case' })).toBeVisible()
  await page.goto(`/projects/${projectId}/test-cases?priority=Critical`)
  await expect(page.getByText('No test cases match these filters')).toBeVisible()
  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({ path: 'test-results/states-filtered-390.png' })
  await noOverflow(page)
  await page.getByRole('button', { name: 'Clear filters' }).last().click()
  await expect(page.getByText('No test cases yet')).toBeVisible()
  await page.context().clearCookies()
  await loginViaUi(page, t.tenantId, viewer.email, viewer.password)
  await page.goto(`/projects/${projectId}/test-cases`)
  await expect(page.getByText('No test cases yet')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Create your first test case' })).toHaveCount(0)
})

test('test runs, repository, defects, access rules: header + empty', async ({ page }) => {
  await admin(page)
  const cases: [string, string, string, string][] = [
    [`/projects/${projectId}/test-runs`, 'Test Runs', 'No test runs yet', 'Create your first test run'],
    ['/test-runs', 'Test Runs', 'No test runs yet', ''],
    ['/test-repository', 'Test Cases', 'No test cases yet', ''],
    ['/defects', 'Defects', 'No defects yet', ''],
    ['/admin/access-rules', 'Access rules', 'No access rules yet', 'Add your first rule'],
  ]
  for (const [url, title, empty, action] of cases) {
    await page.goto(url)
    await expect(page.getByRole('heading', { level: 1, name: title }), url).toBeVisible()
    await expect(page.getByText(empty).first(), url).toBeVisible()
    if (action) await expect(page.getByRole('button', { name: action }), url).toBeVisible()
  }
})

test('defects: filtered variant offers Clear filters', async ({ page }) => {
  await admin(page)
  await page.goto('/defects?severity=Critical')
  await expect(page.getByText('No defects match your filters')).toBeVisible()
  await page.getByRole('button', { name: 'Clear filters' }).last().click()
  await expect(page.getByText('No defects yet')).toBeVisible()
})

test('error state with Retry, then success; skeleton is aria-busy while loading', async ({ page }) => {
  await admin(page)
  const casesApi = (u: URL) => u.pathname.startsWith('/api') && u.pathname.endsWith(`/projects/${projectId}/test-cases`)
  const runsApi = (u: URL) => u.pathname.startsWith('/api') && u.pathname.endsWith(`/projects/${projectId}/test-runs`)
  let fail = true
  await page.route(casesApi, async (route) => {
    if (fail) return route.abort()
    return route.continue()
  })
  await page.goto(`/projects/${projectId}/test-cases`)
  await expect(page.getByText(/Couldn.t load this/)).toBeVisible({ timeout: 20_000 })
  await page.screenshot({ path: 'test-results/states-error.png' })
  fail = false
  await page.getByRole('button', { name: 'Try again' }).click()
  await expect(page.getByText('No test cases yet')).toBeVisible()

  await page.unroute(casesApi)
  await page.route(runsApi, async (route) => {
    await new Promise((r) => setTimeout(r, 1500))
    await route.continue()
  })
  await page.goto(`/projects/${projectId}/test-runs`)
  await expect(page.locator('table[aria-busy="true"]')).toBeVisible()
  await expect(page.getByText('No test runs yet')).toBeVisible()
})

for (const width of [1280, 390]) {
  test(`axe on empty pages at ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    await admin(page)
    for (const url of [`/projects/${projectId}/test-cases`, '/defects', '/admin/access-rules']) {
      await page.goto(url)
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
      await expect(page.getByText(/No .* yet/).first()).toBeVisible()
      const findings = await axeFindings(page)
      expect(findings, formatFindings(url, findings).join(' | ')).toEqual([])
      await noOverflow(page)
    }
  })
}
