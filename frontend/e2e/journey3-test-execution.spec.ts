import { expect, test } from '@playwright/test'

import { bootstrapTenant, loginViaUi } from './fixtures'

async function createApprovedTwoStepCase(page: import('@playwright/test').Page) {
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
  await page.click('button:has-text("Add Step")')
  const actions2 = await page.$$('input[placeholder="Action"]')
  const expecteds2 = await page.$$('input[placeholder="Expected outcome"]')
  await actions2[1].fill('Apply $500 deductible')
  await expecteds2[1].fill('Payout = ACV - 500')
  await page.click('button:has-text("Create Test Case")')
  await expect(page.getByRole('link', { name: 'Verify Total Loss Settlement Calculation' })).toBeVisible({
    timeout: 10000,
  })
  await page.click('a:has-text("Verify Total Loss Settlement Calculation")')
  await page.waitForSelector('text=Steps')
  await page.click('button:has-text("Submit for Review")')
  await expect(page.getByText('Ready for Review')).toBeVisible({ timeout: 10000 })
  await page.click('button:has-text("Approve")')
  await expect(page.getByRole('button', { name: 'Edit' })).toBeVisible({ timeout: 10000 })
}

// BRD Journey 3: run a test case step-by-step; failing a step must
// auto-open the defect dialog pre-populated with full traceability
// (FR-EXEC-003), and the case rollup must flip to Failed.
test('Executing a run: failing a step auto-opens a defect, case rolls up to Failed', async ({
  page,
  request,
}) => {
  const tenant = await bootstrapTenant(request, 'J3Execution')
  await loginViaUi(page, tenant.tenantId, tenant.adminEmail, tenant.adminPassword)
  await createApprovedTwoStepCase(page)

  await page.click('a:has-text("← Test Cases")')
  await page.waitForSelector('text=Verify Total Loss Settlement Calculation', { timeout: 10000 })
  await page.click('a:has-text("← Apex Motor Claims Modernization")')
  await page.waitForSelector('text=Team Members', { timeout: 10000 })
  await page.click('main a:has-text("Test Runs")')
  await page.click('button:has-text("New Test Run")')
  await page.waitForSelector('text=New Test Run')
  await page.fill('#run-name', 'Sprint 42 Motor Regression Cycle')
  await page.click('li label:has-text("Verify Total Loss Settlement Calculation")')
  await page.click('button:has-text("Create Test Run")')
  await expect(page.getByRole('link', { name: 'Execute' })).toBeVisible({ timeout: 10000 })
  await page.click('a:has-text("Execute")')
  await page.waitForSelector('text=Execution Console', { timeout: 10000 })

  await page.click('button:has-text("Pass")')
  await page.waitForSelector('button:has-text("Fail")')
  await page.click('button:has-text("Fail")')

  await expect(page.getByRole('heading', { name: 'Report Defect' })).toBeVisible({ timeout: 10000 })
  await page.selectOption('#defect-severity', 'Critical')
  await page.fill('#defect-description', 'Payout calculation incorrect')
  await page.click('button:has-text("Report Defect")')
  await expect(page.getByText('Defect reported')).toBeVisible({ timeout: 10000 })

  await page.goBack()
  await page.waitForSelector('text=Sprint 42 Motor Regression Cycle', { timeout: 10000 })
  await expect(page.getByText('failed')).toBeVisible({ timeout: 10000 })
})
