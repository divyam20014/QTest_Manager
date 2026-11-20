import { expect, test, type Page } from '@playwright/test'

import { API_BASE_URL, bootstrapTenant, loginViaUi } from './fixtures'

// ADR-086 (GAP-03): erase a user's personal data from the Users admin screen.
// Runs on its own throwaway tenant and a user created in it -- never dev data.

async function noHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
  expect(overflow).toBeLessThanOrEqual(0)
}

test('Admin erases a user from Users & Roles with a typed email confirmation', async ({
  page,
  request,
}) => {
  test.setTimeout(90_000)
  const shots = process.env.E2E_SHOTS_DIR
  const tenant = await bootstrapTenant(request, 'Erase')
  const email = `leaver-${Date.now()}@example.com`

  await loginViaUi(page, tenant.tenantId, tenant.adminEmail, tenant.adminPassword)
  const created = await page.request.post(`${API_BASE_URL}/users`, {
    data: { email, name: 'Leaver Person', role: 'tester', password: 'LeaverPassw0rd1!' },
  })
  expect(created.ok()).toBeTruthy()

  await page.goto('/admin/users')
  await page.waitForSelector('h1:has-text("Users & Roles")')
  await expect(page.getByText('Leaver Person').first()).toBeVisible()

  await page
    .getByRole('button', { name: 'Erase personal data for Leaver Person' })
    .filter({ visible: true })
    .first()
    .click()
  const dialog = page.getByTestId('erase-dialog')
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('group', { name: 'Erasure preview' })).toContainText(
    'Active sessions signed out',
  )

  const confirm = dialog.getByRole('button', { name: 'Erase personal data' })
  await expect(confirm).toBeDisabled()
  await dialog.getByLabel('Type the user’s email to confirm').fill('not-the-email@example.com')
  await expect(confirm).toBeDisabled()
  if (shots) await page.screenshot({ path: `${shots}/user-erasure-dialog-1280.png` })

  await page.setViewportSize({ width: 390, height: 844 })
  await noHorizontalOverflow(page)
  if (shots) await page.screenshot({ path: `${shots}/user-erasure-dialog-390.png` })
  const box = await confirm.boundingBox()
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(44)
  await page.setViewportSize({ width: 1280, height: 800 })

  await dialog.getByLabel('Type the user’s email to confirm').fill(email)
  await expect(confirm).toBeEnabled()
  await confirm.click()

  await expect(page.getByText('Personal data erased')).toBeVisible()
  await expect(page.getByText('Erased user').first()).toBeVisible()
  await expect(page.getByText('Leaver Person')).toHaveCount(0)
  await expect(page.getByText(email)).toHaveCount(0)
  await expect(
    page.getByRole('button', { name: /Erase personal data for/ }).filter({ visible: true }),
  ).toHaveCount(0)
  if (shots) await page.screenshot({ path: `${shots}/user-erasure-after-1280.png` })

  await page.setViewportSize({ width: 390, height: 844 })
  await noHorizontalOverflow(page)
  if (shots) await page.screenshot({ path: `${shots}/user-erasure-after-390.png`, fullPage: true })
})
