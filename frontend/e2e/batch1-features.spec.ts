import { expect, test } from '@playwright/test'

import { API_BASE_URL, loginViaUi, nativeSelect } from './fixtures'
import { seedRoleTenant, type RoleTenant } from './roleTenant'

// ADR-096 batch 1, in a throwaway tenant (seedRoleTenant): rerun failed only,
// a saved view on the defects list, and the version compare diff labels.

test.describe.configure({ mode: 'serial' })

let t: RoleTenant

test.beforeAll(async ({ request }) => {
  t = await seedRoleTenant(request, 'Batch1', { withData: true })
})

test('rerun failed creates a linked run with only the failed case and opens it', async ({ page }) => {
  test.setTimeout(120_000)
  await loginViaUi(page, t.tenantId, t.adminEmail, t.adminPassword)
  await page.goto(`/test-runs/${t.runId}`)
  await expect(page.getByRole('heading', { name: 'Sprint run' })).toBeVisible({ timeout: 15000 })
  await page.getByRole('button', { name: 'Rerun failed' }).click()
  await expect(page.getByRole('heading', { name: 'Sprint run (rerun)' })).toBeVisible({ timeout: 15000 })
  await expect(page).not.toHaveURL(new RegExp(`/test-runs/${t.runId}$`))
  await expect(page.getByText('Verify settlement')).toBeVisible()

  const id = page.url().split('/test-runs/')[1].split(/[?#]/)[0]
  const res = await page.request.get(`${API_BASE_URL}/test-runs/${id}`)
  const run = (await res.json()).data
  expect(run.original_run_id).toBe(t.runId)
  expect(run.cases).toHaveLength(1)

  // Nothing failed or blocked in the new run yet, so there is nothing to rerun.
  await expect(page.getByRole('button', { name: 'Rerun failed' })).toHaveCount(0)
})

test('a saved view on the defects list can be saved, applied and deleted', async ({ page }) => {
  test.setTimeout(120_000)
  await loginViaUi(page, t.tenantId, t.adminEmail, t.adminPassword)
  await page.goto('/defects?severity=High')
  await page.getByRole('button', { name: 'Views' }).click()
  await page.getByLabel('Name for the new view').fill('High severity only')
  await page.getByRole('button', { name: 'Save current' }).click()
  await expect(page.getByRole('menuitem', { name: 'High severity only' })).toBeVisible({ timeout: 10000 })

  // Back on the unfiltered list, applying the view restores the filter in the URL.
  await page.goto('/defects')
  await page.getByRole('button', { name: 'Views' }).click()
  await page.getByRole('menuitem', { name: 'High severity only' }).click()
  await expect(page).toHaveURL(/severity=High/)

  await page.getByRole('button', { name: 'Views' }).click()
  await page.getByRole('button', { name: 'Delete view High severity only' }).click()
  await expect(page.getByRole('menuitem', { name: 'High severity only' })).toHaveCount(0)
  await expect(page.getByText('No saved views yet')).toBeVisible()
})

test('version compare shows per-step changes with text labels and a summary', async ({ page }) => {
  test.setTimeout(120_000)
  await loginViaUi(page, t.tenantId, t.adminEmail, t.adminPassword)
  // Editing an approved case creates version 2: one step reworded, one step added.
  const edit = await page.request.patch(`${API_BASE_URL}/test-cases/${t.caseId}`, {
    data: {
      steps: [
        { action: 'Open the claim file', expected: 'Claim opens' },
        { action: 'Settle the claim', expected: 'Settlement posted' },
        { action: 'Send the receipt', expected: 'Receipt sent' },
      ],
    },
  })
  expect(edit.ok(), await edit.text()).toBeTruthy()

  await page.goto(`/test-cases/${t.caseId}`)
  await page.getByRole('tab', { name: /^Versions/ }).click()
  await nativeSelect(page, 'Compare from version').selectOption('1')
  await nativeSelect(page, 'Compare to version').selectOption('2')
  await expect(page.getByTestId('version-diff-summary')).toHaveText('1 step changed, 1 added')
  const changed = page.locator('[data-testid="version-diff-step"][data-change="modified"]')
  await expect(changed.getByText('Changed', { exact: true })).toBeVisible()
  await expect(changed.locator('ins')).toContainText('file')
  const added = page.locator('[data-testid="version-diff-step"][data-change="added"]')
  await expect(added.getByText('Added', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Show 1 unchanged step' })).toBeVisible()
})
