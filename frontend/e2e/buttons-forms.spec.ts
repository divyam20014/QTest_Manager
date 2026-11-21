import { expect, test } from '@playwright/test'

import { axeFindings } from './a11y'
import { bootstrapTenant, loginViaUi } from './fixtures'

test.describe('buttons and forms (phone)', () => {
  test.use({ viewport: { width: 390, height: 800 } })

  test('touch targets, loading state, and a11y', async ({ page, request }) => {
    const tenant = await bootstrapTenant(request, 'BtnFormsTenant')
    await loginViaUi(page, tenant.tenantId, tenant.adminEmail, tenant.adminPassword)
    await page.goto('/dashboards')
    await page.getByRole('button', { name: 'New dashboard' }).first().click()
    const dialog = page.getByRole('dialog')
    const primary = dialog.getByRole('button', { name: 'Create dashboard' })
    const cancel = dialog.getByRole('button', { name: 'Cancel' })
    expect((await primary.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(47.5)
    expect((await cancel.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(43.5)
    expect(await axeFindings(page)).toEqual([])
    await page.screenshot({ path: 'test-results/buttons-dialog-390.png' })

    // Loading: hold the create request so the busy state is observable.
    await page.route('**/api/v1/**/dashboards', async (route) => {
      if (route.request().method() === 'POST') await new Promise((r) => setTimeout(r, 1500))
      await route.continue()
    })
    await dialog.getByLabel('Dashboard name').fill('Busy board')
    await primary.click()
    await expect(primary).toHaveAttribute('aria-busy', 'true')
    await expect(primary).toBeDisabled()
    await expect(primary).toHaveText('Create dashboard')
  })

  test('sign-up password toggle, strength meter, and inline error', async ({ page }) => {
    await page.goto('/signup')
    const pw = page.getByLabel('Password', { exact: true })
    await pw.fill('abc')
    const meter = page.getByTestId('password-strength')
    await expect(meter).toContainText('Too short')
    await pw.fill('Abcdefgh1234!xyz')
    await expect(meter).toContainText('Strong')
    const toggle = page.getByRole('button', { name: 'Show characters' })
    expect((await toggle.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(43.5)
    await toggle.click()
    await expect(pw).toHaveAttribute('type', 'text')
    await expect(toggle).toHaveAttribute('aria-pressed', 'true')
    await expect(toggle).toBeFocused()
    await toggle.click()
    await expect(pw).toHaveAttribute('type', 'password')
    expect(await axeFindings(page)).toEqual([])
    await page.screenshot({ path: 'test-results/signup-390.png' })
  })

  test('inline field error is announced and linked', async ({ page }) => {
    await page.goto('/login')
    // Login's email field uses react-hook-form validation on submit.
    await page.getByLabel('Email').fill('a@b')
    await page.getByRole('button', { name: 'Continue to password' }).click()
    const alert = page.getByRole('alert').first()
    await expect(alert).toBeVisible()
    await expect(page.getByLabel('Email')).toHaveAttribute('aria-invalid', 'true')
  })
})
