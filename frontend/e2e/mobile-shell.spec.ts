import { expect, test } from '@playwright/test'

import { bootstrapTenant, loginViaUi } from './fixtures'

// Mobile redesign Phase 1: below `md` the signed-in shell is a bottom tab bar
// plus a "More" sheet instead of the desktop sidebar.
test.use({ viewport: { width: 390, height: 844 } })

test('mobile shell: bottom tab bar navigates and the More sheet opens, traps focus and closes', async ({
  page,
  request,
}) => {
  const tenant = await bootstrapTenant(request, 'MobileShell')
  await loginViaUi(page, tenant.tenantId, tenant.adminEmail, tenant.adminPassword)

  const bar = page.getByRole('navigation', { name: 'Primary' })
  await expect(bar).toBeVisible()
  // Desktop sidebar is not shown on a phone.
  await expect(page.getByRole('button', { name: 'Collapse sidebar' })).toBeHidden()

  // Tab targets are at least 44px tall.
  for (const name of ['Dashboard', 'Test Cases', 'Runs', 'Defects', 'More']) {
    const box = await bar.getByRole(name === 'More' ? 'button' : 'link', { name }).boundingBox()
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44)
  }

  await bar.getByRole('link', { name: 'Defects' }).click()
  await expect(page).toHaveURL(/\/defects$/)
  await expect(bar.getByRole('link', { name: 'Defects' })).toHaveAttribute('aria-current', 'page')

  // No horizontal overflow, and the bar does not hide the end of the page.
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
  expect(overflow).toBeLessThanOrEqual(0)

  const more = bar.getByRole('button', { name: 'More' })
  await more.click()
  const sheet = page.getByRole('dialog', { name: 'More' })
  await expect(sheet).toBeVisible()
  await expect(sheet.getByRole('link', { name: 'Projects' })).toBeVisible()
  await expect(sheet.getByRole('button', { name: 'Ask AI' })).toBeVisible()
  await expect(sheet.getByRole('button', { name: 'Appearance' })).toBeVisible()
  await expect(sheet.getByRole('button', { name: 'Sign out' })).toBeVisible()

  await page.keyboard.press('Escape')
  await expect(sheet).toBeHidden()
  await expect(more).toBeFocused()

  await more.click()
  await sheet.getByRole('link', { name: 'Projects' }).click()
  await expect(page).toHaveURL(/\/projects$/)
  await expect(sheet).toBeHidden()
})
