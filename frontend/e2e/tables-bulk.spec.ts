import { expect, test, type Page } from '@playwright/test'

import { axeFindings, formatFindings } from './a11y'
import { API_BASE_URL, loginViaUi } from './fixtures'
import { seedRoleTenant, type RoleTenant } from './roleTenant'

// ADR-105: shared table prefs (density, columns) and Test Cases bulk actions,
// in a throwaway tenant (Admin, Manager and Tester seeded through the API).

test.describe.configure({ mode: 'serial' })

let t: RoleTenant
const titles = [1, 2, 3, 4, 5, 6].map((n) => `Bulk case ${n}`)

test.beforeAll(async ({ request }) => {
  t = await seedRoleTenant(request, 'tblbulk', { withData: true })
  const login = await request.post(`${API_BASE_URL}/auth/login`, {
    data: { tenant_id: t.tenantId, email: t.adminEmail, password: t.adminPassword },
  })
  expect(login.ok(), await login.text()).toBeTruthy()
  const verify = await request.post(`${API_BASE_URL}/auth/mfa/verify`, {
    data: { code: (await login.json()).data.debug_code },
  })
  expect(verify.ok(), await verify.text()).toBeTruthy()
  for (const title of titles) {
    const res = await request.post(`${API_BASE_URL}/projects/${t.projectId}/test-cases`, {
      data: { title, priority: 'Low', steps: [{ action: 'Do it', expected: 'Done' }] },
    })
    expect(res.ok(), await res.text()).toBeTruthy()
  }
  await request.post(`${API_BASE_URL}/auth/logout`)
})

const rows = (page: Page) => page.locator('table[aria-label="Test cases"] tbody tr')
async function rowHeight(page: Page) {
  return (await rows(page).first().boundingBox())!.height
}
async function openList(page: Page, email: string, password: string) {
  await loginViaUi(page, t.tenantId, email, password)
  await page.goto(`/projects/${t.projectId}/test-cases`)
  await expect(page.getByRole('link', { name: titles[0] })).toBeVisible()
}

test('density and column visibility persist; select-all label', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  await openList(page, t.adminEmail, t.adminPassword)
  const comfortable = await rowHeight(page)
  await page.getByRole('button', { name: 'Columns' }).click()
  await page.getByText('compact', { exact: true }).click()
  await page.keyboard.press('Escape')
  const compact = await rowHeight(page)
  expect(compact).toBeLessThan(comfortable)

  await page.getByRole('button', { name: 'Columns' }).click()
  await page.getByRole('checkbox', { name: 'Steps' }).uncheck()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('columnheader', { name: 'Steps' })).toHaveCount(0)

  await page.reload()
  await expect(page.getByRole('link', { name: titles[0] })).toBeVisible()
  expect(Math.abs((await rowHeight(page)) - compact)).toBeLessThan(1)
  await expect(page.getByRole('columnheader', { name: 'Steps' })).toHaveCount(0)
  await expect(page.getByRole('columnheader', { name: 'Priority' })).toBeVisible()

  await page.screenshot({ path: 'test-results/tables-bulk-1280.png' })
  await page.getByRole('checkbox', { name: 'Select all on this page' }).check()
  await expect(page.getByRole('status').filter({ hasText: /\d+ selected/ })).toContainText('7 selected')
  await page.getByRole('checkbox', { name: 'Select all on this page' }).uncheck()
  await expect(page.getByRole('region', { name: 'Bulk actions' })).toHaveCount(0)
})

test('bulk priority and assign with summary, axe at 1280', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  await openList(page, t.adminEmail, t.adminPassword)
  for (const title of titles.slice(0, 3)) await page.getByRole('checkbox', { name: `Select ${title}` }).check()
  await expect(page.getByRole('status').filter({ hasText: /selected/ })).toContainText('3 selected')
  expect(formatFindings('bulk bar 1280', await axeFindings(page))).toEqual([])

  await page.getByRole('button', { name: 'Change priority' }).click()
  await page.getByRole('dialog').getByLabel('Priority').selectOption('Critical')
  await page.getByRole('dialog').getByRole('button', { name: 'Apply' }).click()
  await expect(page.getByText('3 updated')).toBeVisible()
  for (const title of titles.slice(0, 3)) await expect(rows(page).filter({ hasText: title })).toContainText('Critical')
  await expect(page.getByRole('region', { name: 'Bulk actions' })).toHaveCount(0)

  for (const title of titles.slice(0, 2)) await page.getByRole('checkbox', { name: `Select ${title}` }).check()
  await page.getByRole('button', { name: 'Assign', exact: true }).click()
  await page.getByRole('dialog').getByLabel('Assignee').selectOption({ label: 'Manager E2E' })
  await page.getByRole('dialog').getByRole('button', { name: 'Apply' }).click()
  await expect(page.getByText('2 updated')).toBeVisible()
  await expect(rows(page).filter({ hasText: titles[0] })).toContainText('Manager E2E')
})

test('a Tester without testcase.approve gets no Quarantine action', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  await openList(page, t.tester.email, t.tester.password)
  await page.getByRole('checkbox', { name: `Select ${titles[3]}` }).check()
  await expect(page.getByRole('button', { name: 'Change priority' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Quarantine', exact: true })).toHaveCount(0)
})

test('phone: bulk bar is accessible and nothing overflows', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 })
  await openList(page, t.adminEmail, t.adminPassword)
  await page.getByRole('checkbox', { name: `Select ${titles[4]}` }).check()
  await expect(page.getByRole('region', { name: 'Bulk actions' })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  expect(formatFindings('bulk bar 390', await axeFindings(page))).toEqual([])
  await page.screenshot({ path: 'test-results/tables-bulk-390.png' })
})
