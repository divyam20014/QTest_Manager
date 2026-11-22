import { expect, test } from '@playwright/test'

import { API_BASE_URL, loginViaUi, nativeSelect } from './fixtures'
import { seedRoleTenant, type RoleTenant } from './roleTenant'

// Step 6 Reports: tab strip, one Export menu, the shared filter toolbar with chips,
// and chart cards with "View as table" and a "..." menu (Download CSV / PNG).

let t: RoleTenant

test.beforeAll(async ({ request }) => {
  t = await seedRoleTenant(request, 'reports', { withData: true })
  await request.post(`${API_BASE_URL}/auth/logout`)
})

test('tabs, Export menu, filter chips and chart card actions', async ({ page }) => {
  test.setTimeout(120_000)
  await page.setViewportSize({ width: 1280, height: 900 })
  await loginViaUi(page, t.tenantId, t.adminEmail, t.adminPassword)
  await page.goto('/reporting')
  await expect(page.getByRole('heading', { name: 'Reporting', level: 1 })).toBeVisible()

  // Tabs: Overview | Compliance | Report builder.
  const tabs = page.getByRole('navigation', { name: 'Report sections' })
  await expect(tabs.getByRole('link')).toHaveText(['Overview', 'Compliance', 'Report builder'])
  await expect(tabs.getByRole('link', { name: 'Overview' })).toHaveAttribute('aria-current', 'page')

  // One Export dropdown: PDF, CSV, Excel, Print.
  await page.getByRole('button', { name: 'Export', exact: true }).click()
  await expect(page.getByRole('menuitem')).toHaveText(['PDF', 'CSV', 'Excel', 'Print'])
  await page.keyboard.press('Escape')
  await expect(page.getByRole('link', { name: /Download Compliance/ })).toHaveCount(0)

  // Filters popover -> chip -> remove / Clear all.
  const filtersButton = page.getByRole('button', { name: /^Filters/ })
  await filtersButton.click()
  const panel = page.getByRole('dialog', { name: 'Filters' })
  await panel.getByRole('button', { name: 'Last 30 days' }).click()
  await nativeSelect(panel, 'Domain').selectOption('Motor')
  const chips = page.getByRole('list', { name: 'Active filters' })
  await expect(chips.getByText('Domain: Motor')).toBeVisible()
  await expect(chips.getByText(/^Dates:/)).toBeVisible()
  await expect(filtersButton.getByLabel('2 active')).toBeVisible()
  await page.keyboard.press('Escape')
  await chips.getByRole('button', { name: 'Remove Domain filter' }).click()
  await expect(chips.getByText('Domain: Motor')).toHaveCount(0)
  await chips.getByRole('button', { name: 'Clear all' }).click()
  await expect(chips).toHaveCount(0)

  // Chart card: View as table (aria-pressed) and the "..." menu.
  const toggle = page.getByRole('button', { name: 'View as table' }).first()
  await expect(toggle).toBeVisible({ timeout: 30_000 })
  await expect(toggle).toHaveAttribute('aria-pressed', 'false')
  await toggle.click()
  await expect(page.getByRole('button', { name: 'View as chart' }).first()).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('table').first()).toBeVisible()

  const more = page.getByRole('button', { name: "Chart actions" }).first()
  await more.click()
  await expect(page.getByRole('menuitem', { name: 'Download CSV' })).toBeVisible()
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('menuitem', { name: 'Download CSV' }).click(),
  ])
  expect(download.suggestedFilename()).toMatch(/^[a-z0-9-]+-\d{4}-\d{2}-\d{2}\.csv$/)
})
