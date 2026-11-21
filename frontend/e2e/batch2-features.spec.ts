import { expect, test } from '@playwright/test'

import { API_BASE_URL, loginViaUi } from './fixtures'
import { seedRoleTenant, type RoleTenant } from './roleTenant'

// ADR-097 batch 2, in a throwaway tenant: the defect leakage card on Reports,
// quarantining a case from its page, and creating a run that skips it.

test.describe.configure({ mode: 'serial' })

let t: RoleTenant
let otherCaseId: string

test.beforeAll(async ({ request }) => {
  t = await seedRoleTenant(request, 'Batch2', { withData: true })
  await request.post(`${API_BASE_URL}/auth/login`, {
    data: { tenant_id: t.tenantId, email: t.adminEmail, password: t.adminPassword },
  })
})

test('the leakage card shows escaped defects linked to a released release', async ({ page }) => {
  test.setTimeout(120_000)
  await loginViaUi(page, t.tenantId, t.adminEmail, t.adminPassword)
  const rel = await page.request.post(`${API_BASE_URL}/projects/${t.projectId}/releases`, {
    data: { name: 'R1', release_date: '2020-01-01' },
  })
  expect(rel.ok()).toBeTruthy()
  const releaseId = (await rel.json()).data.id
  const link = await page.request.patch(`${API_BASE_URL}/defects/${t.defectId}/build-release`, {
    data: { fixed_in_release_id: releaseId },
  })
  expect(link.ok()).toBeTruthy()

  await page.goto('/reporting')
  const headline = page.getByTestId('leakage-headline')
  await expect(headline).toBeVisible({ timeout: 20000 })
  await expect(headline.getByText('Escaped defects', { exact: true })).toBeVisible()
  await expect(headline.getByText('Total defects', { exact: true })).toBeVisible()
  await expect(headline.getByText('100%').first()).toBeVisible()
  await expect(page.getByText('R1', { exact: true }).first()).toBeVisible()
})

test('a manager can quarantine a case from its page and see the badge', async ({ page }) => {
  test.setTimeout(120_000)
  await loginViaUi(page, t.tenantId, t.adminEmail, t.adminPassword)
  const other = await page.request.post(`${API_BASE_URL}/projects/${t.projectId}/test-cases`, {
    data: { title: 'Stable login check', priority: 'High', steps: [{ action: 'Log in', expected: 'Home shown' }] },
  })
  otherCaseId = (await other.json()).data.id
  await page.request.post(`${API_BASE_URL}/test-cases/${otherCaseId}/submit-review`, { data: {} })
  await page.request.post(`${API_BASE_URL}/test-cases/${otherCaseId}/approve`)

  await page.goto(`/test-cases/${t.caseId}`)
  await page.getByRole('button', { name: 'Quarantine', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel(/Reason/).fill('Fails intermittently on the sandbox')
  await dialog.getByRole('button', { name: 'Quarantine', exact: true }).click()
  await expect(page.getByText('Quarantined', { exact: true }).first()).toBeVisible({ timeout: 15000 })
  await expect(page.getByRole('button', { name: 'Remove quarantine' })).toBeVisible()
})

test('creating a run with the skip option leaves the quarantined case out', async ({ page }) => {
  test.setTimeout(120_000)
  await loginViaUi(page, t.tenantId, t.adminEmail, t.adminPassword)
  await page.goto(`/projects/${t.projectId}/test-runs`)
  await page.getByRole('button', { name: 'New Test Run' }).click()
  await page.getByLabel('Name').fill('Skip quarantined run')
  await page.getByRole('checkbox', { name: /Verify settlement/ }).check()
  await page.getByRole('checkbox', { name: /Stable login check/ }).check()
  await page.getByRole('checkbox', { name: /Skip quarantined cases \(1\)/ }).check()
  await page.getByRole('button', { name: 'Create Test Run' }).click()
  await expect(page).toHaveURL(/\/test-runs\/[0-9a-f-]+$/, { timeout: 15000 })

  const id = page.url().split('/test-runs/')[1].split(/[?#]/)[0]
  const res = await page.request.get(`${API_BASE_URL}/test-runs/${id}`)
  const run = (await res.json()).data
  expect(run.cases).toHaveLength(1)
  expect(run.cases[0].test_case_id).toBe(otherCaseId)
})
