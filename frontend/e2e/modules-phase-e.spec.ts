import { expect, test, type Page, type Route } from '@playwright/test'

import { bootstrapTenant, loginViaUi } from './fixtures'

// UI/UX remediation Phase E: confirmation on destructive actions (type the
// project name to delete it), Test Repository "Load more" with a visible total
// (nothing silently cut off), and the Execution Console verdict shortcuts not
// firing while typing in a text field.

// Mocked replies are cross-origin (page :5173, API :8000): same CORS headers
// the real API sends, including for the preflight.
async function fulfillCors(route: Route, json: unknown) {
  const req = route.request()
  const headers: Record<string, string> = {
    'access-control-allow-origin': req.headers()['origin'] ?? '*',
    'access-control-allow-credentials': 'true',
    'access-control-allow-headers': req.headers()['access-control-request-headers'] ?? '*',
    'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
  }
  if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers })
  return route.fulfill({ status: 200, headers, json: { data: json, error: null } })
}

async function createProject(page: Page, name: string) {
  await page.click('a:has-text("Projects")')
  await page.click('button:has-text("New Project")')
  await page.waitForSelector('text=New Project')
  await page.fill('#name', name)
  await page.selectOption('#domain', 'Motor')
  await page.selectOption('#priority', 'High')
  await page.fill('#manager_name', 'Jane Manager')
  await page.fill('#start_date', '2026-01-01')
  await page.fill('#end_date', '2026-12-31')
  await page.fill('#budget', '1000')
  await page.fill('#region', 'EMEA')
  await page.click('button:has-text("Create Project")')
  await expect(page.getByRole('link', { name })).toBeVisible({ timeout: 10000 })
}

test('deleting a project needs its name typed; cancel keeps it', async ({ page, request }) => {
  const tenant = await bootstrapTenant(request, 'PhaseE')
  await loginViaUi(page, tenant.tenantId, tenant.adminEmail, tenant.adminPassword)
  const name = 'Confirm Delete Project'
  await createProject(page, name)
  await page.getByRole('link', { name }).click()
  await page.click('nav[aria-label="Project sections"] >> text=Details')

  await page.getByRole('button', { name: 'Delete Project' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await expect(dialog.getByText(/cannot be undone/i)).toBeVisible()
  const confirm = dialog.getByRole('button', { name: 'Delete project' })
  await expect(confirm).toBeDisabled()
  await dialog.getByLabel(/Type .* to confirm/).fill('wrong name')
  await expect(confirm).toBeDisabled()

  // Escape cancels: the project is still there.
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible()

  await page.getByRole('button', { name: 'Delete Project' }).click()
  await page.getByRole('dialog').getByLabel(/Type .* to confirm/).fill(name)
  await page.getByRole('dialog').getByRole('button', { name: 'Delete project' }).click()
  await expect(page).toHaveURL(/\/projects$/, { timeout: 10000 })
  await expect(page.getByRole('link', { name })).toHaveCount(0)
})

test('removing an environment asks first; cancel keeps it', async ({ page, request }) => {
  const tenant = await bootstrapTenant(request, 'PhaseE')
  await loginViaUi(page, tenant.tenantId, tenant.adminEmail, tenant.adminPassword)
  await page.goto('/admin/environments')
  await page.fill('#env-name', 'Staging')
  await page.getByRole('button', { name: /^Add/ }).click()
  await expect(page.getByText('Staging', { exact: true })).toBeVisible()

  await page.getByRole('button', { name: 'Remove' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByText('Remove environment “Staging”?')).toBeVisible()
  await dialog.getByRole('button', { name: 'Cancel' }).click()
  await expect(page.getByText('Staging', { exact: true })).toBeVisible()

  await page.getByRole('button', { name: 'Remove' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Remove environment' }).click()
  await expect(page.getByText('Staging', { exact: true })).toHaveCount(0)
})

test('Test Repository: Load more shows the real total and appends the rest', async ({ page, request }) => {
  const tenant = await bootstrapTenant(request, 'PhaseE')
  await loginViaUi(page, tenant.tenantId, tenant.adminEmail, tenant.adminPassword)

  const project = {
    id: '11111111-1111-1111-1111-111111111111',
    name: 'Big Project',
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
    test_case_count: 120,
    approved_test_case_count: 0,
    test_run_count: 0,
    open_defect_count: 0,
  }
  const TOTAL = 120
  const makeCase = (n: number) => ({
    id: `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`,
    project_id: project.id,
    title: `Case ${String(n).padStart(3, '0')}`,
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
    created_at: new Date(Date.UTC(2026, 0, 1, 0, 0, TOTAL - n)).toISOString(),
    steps: [],
    custom_fields: {},
    scenario_id: null,
    scenario_description: null,
    prerequisite: null,
    test_data: null,
    last_execution_result: null,
    last_executed_by_name: null,
    last_execution_date: null,
  })

  await page.route(/\/api\/v1\/projects\?.*/, (route) => fulfillCors(route, { items: [project], total: 1 }))
  await page.route(/\/api\/v1\/projects\/[^/]+\/test-cases(\?.*)?$/, (route) => {
    const url = new URL(route.request().url())
    const pageNo = Number(url.searchParams.get('page') ?? '1')
    const size = Number(url.searchParams.get('page_size') ?? '50')
    const start = (pageNo - 1) * size
    const items = Array.from({ length: Math.max(0, Math.min(size, TOTAL - start)) }, (_, i) => makeCase(start + i + 1))
    return fulfillCors(route, { items, total: TOTAL })
  })

  await page.goto('/test-repository')
  await expect(page.getByText('Case 001').first()).toBeVisible({ timeout: 15000 })
  // 50 of 120 shown, and the footer says so instead of pretending that is everything.
  await expect(page.getByText(/50 test cases shown of 120 matching/)).toBeVisible()
  const loadMore = page.getByRole('button', { name: /Load more \(70 remaining\)/ })
  await loadMore.click()
  await expect(page.getByText(/100 test cases shown of 120 matching/)).toBeVisible()
  await page.getByRole('button', { name: /Load more \(20 remaining\)/ }).click()
  await expect(page.getByText(/120 test cases shown across 1 project/)).toBeVisible()
  await expect(page.getByRole('button', { name: /Load more/ })).toHaveCount(0)
})
