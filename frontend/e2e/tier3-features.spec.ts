import { expect, test } from '@playwright/test'

import { bootstrapTenant, loginViaUi } from './fixtures'

// Tier 3: module grouping, review-request/approval workflow, global search,
// and the theme toggle.
test('Module grouping, request-changes, global search, and theme toggle', async ({
  page,
  request,
}) => {
  const tenant = await bootstrapTenant(request, 'Tier3Features')
  await loginViaUi(page, tenant.tenantId, tenant.adminEmail, tenant.adminPassword)

  await page.click('a:has-text("Projects")')
  await page.click('button:has-text("New Project")')
  await page.waitForSelector('text=New Project')
  await page.fill('#name', 'Tier3 Feature Project')
  await page.selectOption('#domain', 'Motor')
  await page.selectOption('#priority', 'High')
  await page.fill('#manager_name', 'Jane Manager')
  await page.fill('#start_date', '2026-01-01')
  await page.fill('#end_date', '2026-12-31')
  await page.fill('#budget', '450000')
  await page.fill('#region', 'North America')
  await page.click('button:has-text("Create Project")')
  await page.click('a:has-text("Tier3 Feature Project")')
  await page.waitForSelector('text=Team Members')

  await page.click('a:has-text("Test Cases")')

  // Modules: create one via the "Manage Modules" dialog.
  await page.click('button:has-text("Manage Modules")')
  await page.fill('#new-module-name', 'Claims Intake')
  await page.click('div[role="dialog"] button:has-text("Add")')
  await expect(page.getByText('Claims Intake (0 test cases)')).toBeVisible({ timeout: 10000 })
  await page.click('div[role="presentation"]', { position: { x: 5, y: 5 } })

  await page.click('button:has-text("New Test Case")')
  await page.waitForSelector('text=New Test Case')
  await page.fill('#title', 'Verify Flood Damage Exclusion Clause')
  await page.selectOption('#priority', 'High')
  const actions = await page.$$('input[placeholder="Action"]')
  const expecteds = await page.$$('input[placeholder="Expected outcome"]')
  await actions[0].fill('Submit flood claim')
  await expecteds[0].fill('Exclusion clause applied')
  await page.click('button:has-text("Create Test Case")')
  await expect(
    page.getByRole('link', { name: 'Verify Flood Damage Exclusion Clause' }),
  ).toBeVisible({ timeout: 10000 })

  // Submit for review, then send it back with Request Changes.
  await page.click('a:has-text("Verify Flood Damage Exclusion Clause")')
  await page.waitForSelector('text=Steps')
  await page.click('button:has-text("Submit for Review")')
  await page.click('div[role="dialog"] button:has-text("Submit")')
  await expect(page.getByText('Ready for Review')).toBeVisible({ timeout: 10000 })
  await page.click('button:has-text("Request Changes")')
  await page.fill('#changes-comment', 'Please clarify the exclusion wording.')
  await page.click('div[role="dialog"] button:has-text("Send Back for Changes")')
  await expect(page.getByText('Draft').first()).toBeVisible({ timeout: 10000 })
  await expect(page.getByText('Please clarify the exclusion wording.')).toBeVisible({
    timeout: 10000,
  })

  // Global search finds the test case by title.
  await page.fill('input[placeholder*="Search test cases"]', 'Flood Damage')
  await expect(page.getByText('Verify Flood Damage Exclusion Clause')).toBeVisible({
    timeout: 10000,
  })
  await page.click('main', { position: { x: 5, y: 400 } })

  // Theme toggle flips the root data-theme attribute and persists it.
  const initialTheme = await page.evaluate(() => document.documentElement.dataset.theme)
  await page.click('button[aria-label*="Switch to"]')
  await expect
    .poll(() => page.evaluate(() => document.documentElement.dataset.theme))
    .not.toBe(initialTheme)
  await page.reload()
  await expect
    .poll(() => page.evaluate(() => document.documentElement.dataset.theme))
    .not.toBe(initialTheme)
})
