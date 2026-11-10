import { expect, test } from '@playwright/test'

import { bootstrapTenant, loginViaUi } from './fixtures'

// BRD Journey 2: author a test case, submit it for review, approve it, then
// edit the approved case -- which must fork a new version and revert the
// case to Draft rather than silently mutating the approved v1 (ADR-003/
// ADR-020).
test('Test case authoring: draft -> submit -> approve -> edit forks a new version', async ({
  page,
  request,
}) => {
  const tenant = await bootstrapTenant(request, 'J2TestCases')
  await loginViaUi(page, tenant.tenantId, tenant.adminEmail, tenant.adminPassword)

  await page.click('a:has-text("Projects")')
  await page.click('button:has-text("New Project")')
  await page.waitForSelector('text=New Project')
  await page.fill('#name', 'Apex Motor Claims Modernization')
  await page.selectOption('#domain', 'Motor')
  await page.selectOption('#priority', 'High')
  await page.fill('#manager_name', 'Jane Manager')
  await page.fill('#start_date', '2026-01-01')
  await page.fill('#end_date', '2026-12-31')
  await page.fill('#budget', '450000')
  await page.fill('#region', 'North America')
  await page.click('button:has-text("Create Project")')
  await page.click('a:has-text("Apex Motor Claims Modernization")')
  await page.waitForSelector('text=Team Members')

  await page.click('a:has-text("Test Cases")')
  await page.click('button:has-text("New Test Case")')
  await page.waitForSelector('text=New Test Case')
  await page.fill('#title', 'Verify Total Loss Settlement Calculation')
  await page.selectOption('#priority', 'Critical')
  const actions = await page.$$('input[placeholder="Action"]')
  const expecteds = await page.$$('input[placeholder="Expected outcome"]')
  await actions[0].fill('Input Policy Number')
  await expecteds[0].fill('ACV displayed')
  await page.click('button:has-text("Create Test Case")')
  await expect(page.getByRole('link', { name: 'Verify Total Loss Settlement Calculation' })).toBeVisible({
    timeout: 10000,
  })

  await page.click('a:has-text("Verify Total Loss Settlement Calculation")')
  await page.waitForSelector('text=Steps')
  await page.click('button:has-text("Submit for Review")')
  await page.click('div[role="dialog"] button:has-text("Submit")')
  await expect(page.getByText('Ready for Review')).toBeVisible({ timeout: 10000 })
  await page.click('button:has-text("Approve")')
  await expect(page.getByRole('button', { name: 'Edit' })).toBeVisible({ timeout: 10000 })

  // Editing the now-approved case must fork it to v2 and revert to Draft,
  // not mutate the approved v1 in place.
  await page.click('button:has-text("Edit")')
  await page.fill('#title', 'Verify Total Loss Settlement Calculation (revised)')
  await page.click('button:has-text("Save Changes")')

  await expect(page.getByText('Draft')).toBeVisible({ timeout: 10000 })
  await expect(page.getByText('v2').first()).toBeVisible()
})
