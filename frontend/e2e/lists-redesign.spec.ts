import { expect, test, type Page } from '@playwright/test'

import { API_BASE_URL, loginViaUi, nativeSelect } from './fixtures'
import { seedRoleTenant, type RoleTenant } from './roleTenant'

// Step 5 list pages: one toolbar (search, Filters popover, chips, saved views, columns),
// status tabs with counts, a row detail drawer and the "Showing x-y of n" footer on
// Defects, Test Cases (project list + repository), Test Runs and Projects.

test.describe.configure({ mode: 'serial' })

let t: RoleTenant

test.beforeAll(async ({ request }) => {
  t = await seedRoleTenant(request, 'lists', { withData: true })
  const login = await request.post(`${API_BASE_URL}/auth/login`, {
    data: { tenant_id: t.tenantId, email: t.adminEmail, password: t.adminPassword },
  })
  expect(login.ok(), await login.text()).toBeTruthy()
  const verify = await request.post(`${API_BASE_URL}/auth/mfa/verify`, {
    data: { code: (await login.json()).data.debug_code },
  })
  expect(verify.ok(), await verify.text()).toBeTruthy()
  // Two more defects (one moved to Open) and two draft cases on top of the seeded data.
  const ids: string[] = []
  for (const title of ['Login button misaligned', 'Export drops a column']) {
    const res = await request.post(`${API_BASE_URL}/defects`, {
      data: { project_id: t.projectId, title, severity: 'Low', priority: 'Low', description: `${title}: seen in the nightly build.` },
    })
    expect(res.ok(), await res.text()).toBeTruthy()
    ids.push((await res.json()).data.id)
  }
  const patch = await request.patch(`${API_BASE_URL}/defects/${ids[0]}/status`, { data: { status: 'Open' } })
  expect(patch.ok(), await patch.text()).toBeTruthy()
  for (const title of ['Draft case one', 'Draft case two']) {
    const res = await request.post(`${API_BASE_URL}/projects/${t.projectId}/test-cases`, {
      data: { title, priority: 'Low', steps: [{ action: 'Do it', expected: 'Done' }] },
    })
    expect(res.ok(), await res.text()).toBeTruthy()
  }
  await request.post(`${API_BASE_URL}/auth/logout`)
})

const admin = (page: Page) => loginViaUi(page, t.tenantId, t.adminEmail, t.adminPassword)

test('defects: tabs with counts, Filters popover, chips, Clear all, search', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  await admin(page)
  await page.goto('/defects')
  const tabs = page.getByRole('tablist', { name: 'Defect status' })
  await expect(tabs.getByRole('tab', { name: /^All\s*3$/ })).toBeVisible()
  await expect(tabs.getByRole('tab', { name: /^New\s*2$/ })).toBeVisible()
  await expect(tabs.getByRole('tab', { name: /^Open\s*1$/ })).toBeVisible()
  await expect(page.getByText('Showing 1-3 of 3')).toBeVisible()

  // The status tab drives the ?status= param and narrows the footer.
  await tabs.getByRole('tab', { name: /^Open/ }).click()
  await expect(page).toHaveURL(/status=Open/)
  await expect(page.getByText('Showing 1-1 of 1')).toBeVisible()
  await tabs.getByRole('tab', { name: /^All/ }).click()
  await expect(page).not.toHaveURL(/status=/)

  // One Filters button with every filter inside a popover; Escape closes it and returns focus.
  const filtersButton = page.getByRole('button', { name: /^Filters/ })
  await filtersButton.click()
  const panel = page.getByRole('dialog', { name: 'Filters' })
  await expect(panel).toBeVisible()
  await nativeSelect(panel, 'Filter by severity').selectOption('Low')
  await expect(page.getByRole('list', { name: 'Active filters' }).getByText('Severity: Low')).toBeVisible()
  await expect(filtersButton.getByLabel('1 active')).toBeVisible()
  await expect(page.getByText('Showing 1-2 of 2')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(panel).toBeHidden()
  await expect(filtersButton).toBeFocused()

  // Chips remove one filter / Clear all removes everything.
  await page.getByRole('button', { name: 'Clear all' }).click()
  await expect(page.getByRole('list', { name: 'Active filters' })).toHaveCount(0)
  await expect(page).not.toHaveURL(/severity=/)
  await expect(page.getByText('Showing 1-3 of 3')).toBeVisible()

  await page.locator('#defect-search').fill('export drops')
  await expect(page.getByText('Showing 1-1 of 1')).toBeVisible()
  await page.locator('#defect-search').fill('no such defect')
  await expect(page.getByText('No defects match your filters')).toBeVisible()
  await page.getByRole('button', { name: 'Clear filters' }).click()
  await expect(page.getByText('Showing 1-3 of 3')).toBeVisible()
})

test('defects: row click opens the drawer, the title link still goes to the page', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  await admin(page)
  await page.goto('/defects')
  const row = page.getByRole('row').filter({ hasText: 'Export drops a column' })
  await row.getByRole('cell').nth(1).click()
  const drawer = page.getByRole('dialog', { name: 'Export drops a column' })
  await expect(drawer).toBeVisible()
  await expect(drawer.getByText('seen in the nightly build')).toBeVisible()
  await expect(drawer.getByRole('link', { name: 'Open full page' })).toHaveAttribute('href', /\/defects\//)
  await page.keyboard.press('Escape')
  await expect(drawer).toBeHidden()
  // Focus returns to the row, and Enter on the focused row opens it again.
  await expect(row).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(drawer).toBeVisible()
  await page.keyboard.press('Escape')

  await row.getByRole('link', { name: 'Export drops a column' }).click()
  await expect(page).toHaveURL(/\/defects\/[0-9a-f-]+$/)
})

test('test cases: status tabs with counts, filters popover, drawer, footer', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  await admin(page)
  await page.goto(`/projects/${t.projectId}/test-cases`)
  const tabs = page.getByRole('tablist', { name: 'Test case status' })
  await expect(tabs.getByRole('tab', { name: /^All\s*3$/ })).toBeVisible()
  await expect(tabs.getByRole('tab', { name: /^Draft\s*2$/ })).toBeVisible()
  await expect(tabs.getByRole('tab', { name: /^Approved\s*1$/ })).toBeVisible()
  await expect(page.getByText('Showing 1-3 of 3')).toBeVisible()

  // Secondary actions live in the "..." menu; one primary action stays in the header.
  await expect(page.getByRole('button', { name: 'New Test Case' })).toBeVisible()
  await page.getByRole('button', { name: 'More actions' }).click()
  await expect(page.getByRole('menuitem', { name: 'Import CSV' })).toBeVisible()
  await expect(page.getByRole('menuitem', { name: 'Export CSV' })).toBeVisible()
  await page.keyboard.press('Escape')

  await tabs.getByRole('tab', { name: /^Approved/ }).click()
  await expect(page).toHaveURL(/status=approved/)
  await expect(page.getByText('Showing 1-1 of 1')).toBeVisible()
  await expect(page.getByRole('link', { name: 'Verify settlement' })).toBeVisible()

  // Row click opens the drawer; the link navigates.
  await page.getByRole('row').filter({ hasText: 'Verify settlement' }).getByRole('cell').nth(3).click()
  const drawer = page.getByRole('dialog', { name: 'Verify settlement' })
  await expect(drawer).toBeVisible()
  await expect(drawer.getByRole('link', { name: 'Open full page' })).toHaveAttribute('href', /\/test-cases\//)
  await page.keyboard.press('Escape')
  await expect(drawer).toBeHidden()

  // Filters popover + chip + Clear all.
  await tabs.getByRole('tab', { name: /^All/ }).click()
  await expect(page).not.toHaveURL(/status=/)
  await page.getByRole('button', { name: /^Filters/ }).click()
  const panel = page.getByRole('dialog', { name: 'Filters' })
  await nativeSelect(panel, 'Priority').selectOption('Low')
  await expect(page.getByRole('list', { name: 'Active filters' }).getByText('Priority: Low')).toBeVisible()
  await expect(page.getByText('Showing 1-2 of 2')).toBeVisible()
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Clear all' }).click()
  await expect(page.getByText('Showing 1-3 of 3')).toBeVisible()
})

test('test repository, test runs and projects share the same layout', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  await admin(page)

  await page.goto('/test-repository')
  const caseTabs = page.getByRole('tablist', { name: 'Test case status' })
  await expect(caseTabs.getByRole('tab', { name: /^Approved\s*1$/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /^Filters/ })).toBeVisible()
  await caseTabs.getByRole('tab', { name: /^Draft/ }).click()
  await expect(page.getByText(/Showing 1-2 of 2/)).toBeVisible()
  await page.getByRole('row').filter({ hasText: 'Draft case one' }).getByRole('cell').nth(3).click()
  await expect(page.getByRole('dialog', { name: 'Draft case one' }).getByRole('link', { name: 'Open full page' })).toBeVisible()
  await page.keyboard.press('Escape')

  await page.goto('/test-runs')
  const runTabs = page.getByRole('tablist', { name: 'Test run status' })
  await expect(runTabs.getByRole('tab', { name: /^All\s*1$/ })).toBeVisible()
  await expect(runTabs.getByRole('tab', { name: /^In progress\s*1$/ })).toBeVisible()
  await expect(runTabs.getByRole('tab', { name: /^Finished\s*0$/ })).toBeVisible()
  await expect(page.getByText('Showing 1-1 of 1')).toBeVisible()
  await runTabs.getByRole('tab', { name: /^Paused/ }).click()
  await expect(page.getByText('No test runs match these filters')).toBeVisible()
  await runTabs.getByRole('tab', { name: /^All/ }).click()
  await page.getByRole('row').filter({ hasText: 'Sprint run' }).getByRole('cell').nth(3).click()
  await expect(page.getByRole('dialog', { name: 'Sprint run' }).getByRole('link', { name: 'Open full page' })).toBeVisible()
  await page.keyboard.press('Escape')

  await page.goto('/projects')
  const projectTabs = page.getByRole('tablist', { name: 'Project status' })
  await expect(projectTabs.getByRole('tab', { name: /^All\s*1$/ })).toBeVisible()
  await expect(page.getByText('Showing 1-1 of 1')).toBeVisible()
  await page.getByRole('row').filter({ hasText: 'Apex Motor Claims' }).getByRole('cell').nth(1).click()
  await expect(
    page.getByRole('dialog', { name: 'Apex Motor Claims' }).getByRole('link', { name: 'Open full page' }),
  ).toHaveAttribute('href', /\/projects\//)
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: /^Filters/ }).click()
  await nativeSelect(page.getByRole('dialog', { name: 'Filters' }), 'Domain').selectOption('Health')
  await expect(page.getByText('No projects match these filters')).toBeVisible()
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Clear all' }).click()
  await expect(page.getByRole('link', { name: 'Apex Motor Claims' })).toBeVisible()
})
