import { expect, test } from '@playwright/test'

import { bootstrapTenant, loginViaUi, createTestCaseViaForm, reportDefectFromDialog } from './fixtures'

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
  await page.click('nav[aria-label="Project sections"] >> text=Details')
  await page.waitForSelector('text=Team Members')

  await page.click('nav[aria-label="Project sections"] >> text=Test Cases')
  await page.click('button:has-text("New Test Case")')
  await page.waitForSelector('text=New Test Case')
  await createTestCaseViaForm(page, {
    title: 'Verify Total Loss Settlement Calculation',
    priority: 'Critical',
    steps: [{ action: 'Input Policy Number', expected: 'ACV displayed' }, { action: 'Apply $500 deductible', expected: 'Payout = ACV - 500' }],
  })
  await expect(page.getByRole('link', { name: 'Verify Total Loss Settlement Calculation' })).toBeVisible({
    timeout: 10000,
  })
  await page.click('a:has-text("Verify Total Loss Settlement Calculation")')
  await page.waitForSelector('text=Steps')
  await page.click('button:has-text("Submit for Review")')
  await page.click('div[role="dialog"] button:has-text("Submit")')
  await expect(page.getByText('Ready for Review').first()).toBeVisible({ timeout: 10000 })
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
  await page.click('nav[aria-label="Project sections"] >> text=Details')
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
  await expect(page.getByRole('group', { name: 'Record a verdict for the current step' })).toContainText('Step 2:')
  await page.fill('#actual-result', 'Payout does not match the expected value')
  await page.click('button:has-text("Fail")')

  await reportDefectFromDialog(page, { severity: 'Critical', description: 'Payout calculation incorrect' })
  await expect(page.getByText('Defect reported')).toBeVisible({ timeout: 10000 })

  await page.goBack()
  await page.waitForSelector('text=Sprint 42 Motor Regression Cycle', { timeout: 10000 })
  // Exact cell match: the Linked Defects card below also contains the word
  // "failed" (the defect raised from the failed step is titled "TC_... failed"), so a
  // loose getByText('failed') is ambiguous once that card has loaded.
  await expect(page.getByRole('cell', { name: 'Failed', exact: true })).toBeVisible({ timeout: 10000 })
})
