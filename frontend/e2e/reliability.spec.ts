import { expect, test } from '@playwright/test'

import { bootstrapTenant, loginViaUi } from './fixtures'

async function createApprovedTwoStepCase(page: import('@playwright/test').Page) {
  await page.click('a:has-text("Projects")')
  await page.click('button:has-text("New Project")')
  await page.waitForSelector('text=New Project')
  await page.fill('#name', 'Reliability Regression Project')
  await page.selectOption('#domain', 'Motor')
  await page.selectOption('#priority', 'High')
  await page.fill('#manager_name', 'Jane Manager')
  await page.fill('#start_date', '2026-01-01')
  await page.fill('#end_date', '2026-12-31')
  await page.fill('#budget', '450000')
  await page.fill('#region', 'North America')
  await page.click('button:has-text("Create Project")')
  await page.click('a:has-text("Reliability Regression Project")')
  await page.waitForSelector('text=Team Members')

  await page.click('a:has-text("Test Cases")')
  await page.click('button:has-text("New Test Case")')
  await page.waitForSelector('text=New Test Case')
  await page.fill('#title', 'Verify Reliability Refresh Case')
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
  await expect(page.getByRole('link', { name: 'Verify Reliability Refresh Case' })).toBeVisible({
    timeout: 10000,
  })
  await page.click('a:has-text("Verify Reliability Refresh Case")')
  await page.waitForSelector('text=Steps')
  await page.click('button:has-text("Submit for Review")')
  await expect(page.getByText('Ready for Review')).toBeVisible({ timeout: 10000 })
  await page.click('button:has-text("Approve")')
  await expect(page.getByRole('button', { name: 'Edit' })).toBeVisible({ timeout: 10000 })
}

// Reliability: a browser refresh mid-execution must not lose or reset
// execution state, since the Execution Console holds no client-only state
// -- every field (opened_at, verdict, duration_ms) is re-fetched from the
// server on mount (see ExecutionConsole.tsx's useQuery calls). This proves
// that contract holds through an actual reload, not just by code review.
test('Browser refresh during execution preserves in-progress step state', async ({
  page,
  request,
}) => {
  const tenant = await bootstrapTenant(request, 'ReliabilityRefresh')
  await loginViaUi(page, tenant.tenantId, tenant.adminEmail, tenant.adminPassword)
  await createApprovedTwoStepCase(page)

  await page.click('a:has-text("← Test Cases")')
  await page.waitForSelector('text=Verify Reliability Refresh Case', { timeout: 10000 })
  await page.click('a:has-text("← Reliability Regression Project")')
  await page.waitForSelector('text=Team Members', { timeout: 10000 })
  await page.click('main a:has-text("Test Runs")')
  await page.click('button:has-text("New Test Run")')
  await page.waitForSelector('text=New Test Run')
  await page.fill('#run-name', 'Reliability Refresh Run')
  await page.click('li label:has-text("Verify Reliability Refresh Case")')
  await page.click('button:has-text("Create Test Run")')
  await expect(page.getByRole('link', { name: 'Execute' })).toBeVisible({ timeout: 10000 })
  await page.click('a:has-text("Execute")')
  await page.waitForSelector('text=Execution Console', { timeout: 10000 })

  // Step 1 auto-opens its server-side timer on mount (FR-EXEC-002). Give it
  // a moment to actually open before capturing "elapsed" state.
  await expect(page.getByText(/\ds elapsed/)).toBeVisible({ timeout: 10000 })
  const urlBeforeReload = page.url()
  await page.waitForTimeout(1500)

  await page.reload()

  // Post-reload: the console must rehydrate from the server, not reset.
  await page.waitForSelector('text=Execution Console', { timeout: 10000 })
  expect(page.url()).toBe(urlBeforeReload)
  await expect(page.getByText('1. Input Policy Number')).toBeVisible({ timeout: 10000 })
  await expect(page.getByText('0/2 steps complete')).toBeVisible()
  // The timer resumed from the server's original opened_at rather than
  // restarting at 0s -- proves the backend, not the browser, owns timing.
  const elapsedText = await page.getByText(/\ds elapsed/).textContent()
  const elapsedSeconds = Number(elapsedText?.match(/(\d+)s elapsed/)?.[1] ?? 0)
  expect(elapsedSeconds).toBeGreaterThanOrEqual(1)

  // Execution is still fully usable post-reload -- not a dead/broken state.
  await page.click('button:has-text("Pass")')
  await page.waitForSelector('text=1/2 steps complete', { timeout: 10000 })
})
