import { expect, test } from '@playwright/test'

import { bootstrapTenant, loginViaUi, createTestCaseViaForm } from './fixtures'

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
  await page.click('nav[aria-label="Project sections"] >> text=Team')
  await page.waitForSelector('text=Team Members')

  await page.click('nav[aria-label="Project sections"] >> text=Test Cases')

  // Modules: create one via the "Manage Modules" dialog.
  await page.getByRole('button', { name: 'More actions' }).click()
  await page.getByRole('menuitem', { name: 'Manage Modules' }).click()
  await page.fill('#new-module-name', 'Claims Intake')
  await page.click('div[role="dialog"] button:has-text("Add")')
  await expect(page.getByText('Claims Intake (0 test cases)')).toBeVisible({ timeout: 10000 })
  await page.click('div[role="presentation"]', { position: { x: 5, y: 5 } })

  await page.click('button:has-text("New Test Case")')
  await page.waitForSelector('text=New Test Case')
  await createTestCaseViaForm(page, {
    title: 'Verify Flood Damage Exclusion Clause',
    module: 'Claims Intake',
    priority: 'High',
    steps: [{ action: 'Submit flood claim', expected: 'Exclusion clause applied' }],
  })
  await expect(
    page.getByRole('link', { name: 'Verify Flood Damage Exclusion Clause' }),
  ).toBeVisible({ timeout: 10000 })

  // Submit for review, then send it back with Request Changes.
  await page.click('a:has-text("Verify Flood Damage Exclusion Clause")')
  await page.waitForSelector('text=Steps')
  await page.click('button:has-text("Submit for Review")')
  await page.click('div[role="dialog"] button:has-text("Submit")')
  await expect(page.getByText('Ready for Review').first()).toBeVisible({ timeout: 10000 })
  await page.click('button:has-text("Request Changes")')
  await page.fill('#changes-comment', 'Please clarify the exclusion wording.')
  await page.click('div[role="dialog"] button:has-text("Send Back for Changes")')
  await expect(page.getByText('Draft').first()).toBeVisible({ timeout: 10000 })
  await expect(page.getByText('Please clarify the exclusion wording.')).toBeVisible({
    timeout: 10000,
  })

  // Global search finds the test case by title.
  // The top bar's search field opens the command palette (ADR-121).
  await page.getByRole('search').getByRole('button').click()
  await page.getByLabel('Command palette search').fill('Flood Damage')
  await expect(
    page.getByRole('dialog', { name: 'Command palette' }).getByText('Verify Flood Damage Exclusion Clause'),
  ).toBeVisible({
    timeout: 10000,
  })
  await page.keyboard.press('Escape')

  // Theme toggle flips the root data-theme attribute and persists it.
  const initialTheme = await page.evaluate(() => document.documentElement.dataset.theme)
  // The toggle opens the Appearance picker (ADR-100); choose a theme that differs from the current one.
  await page.getByRole('button', { name: /account menu$/ }).click()
  await page.getByRole('button', { name: 'Appearance' }).first().click()
  await page
    .getByRole('dialog', { name: 'Appearance' })
    .getByRole('radio', { name: initialTheme === 'dark' ? /^light/i : /^dark/i })
    .click()
  await expect
    .poll(() => page.evaluate(() => document.documentElement.dataset.theme))
    .not.toBe(initialTheme)
  await page.reload()
  await expect
    .poll(() => page.evaluate(() => document.documentElement.dataset.theme))
    .not.toBe(initialTheme)
})
