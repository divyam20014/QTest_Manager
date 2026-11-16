import { expect, test } from '@playwright/test'

import { bootstrapTenant, loginViaUi } from './fixtures'

// UI/UX remediation Phase F: form standards (errors tied to their fields, an
// unsaved-changes prompt before a dialog is dismissed), accessible names on
// data tables and previously unlabeled inputs, and 44px inner links on phone
// cards.

test('project form: every error is shown, tied to its field, and announced', async ({ page, request }) => {
  const tenant = await bootstrapTenant(request, 'PhaseF')
  await loginViaUi(page, tenant.tenantId, tenant.adminEmail, tenant.adminPassword)
  await page.goto('/projects')
  await page.getByRole('button', { name: 'New Project' }).click()
  const dialog = page.getByRole('dialog', { name: 'New Project' })
  await dialog.getByRole('button', { name: 'Create Project' }).click()

  // These three used to fail validation with no message at all.
  for (const id of ['manager_name', 'start_date', 'region']) {
    const field = dialog.locator(`#${id}`)
    await expect(field).toHaveAttribute('aria-invalid', 'true')
    const describedBy = await field.getAttribute('aria-describedby')
    expect(describedBy).toBeTruthy()
    await expect(dialog.locator(`#${describedBy}`)).toHaveText('Required')
    await expect(dialog.locator(`#${describedBy}`)).toHaveAttribute('role', 'alert')
  }
  // A negative budget is reported too (it used to be silent).
  await dialog.locator('#budget').fill('-5')
  await dialog.getByRole('button', { name: 'Create Project' }).click()
  await expect(dialog.getByText('Must be zero or more')).toBeVisible()
})

test('dismissing a dialog with unsaved edits asks first; clean dialogs just close', async ({ page, request }) => {
  const tenant = await bootstrapTenant(request, 'PhaseF')
  await loginViaUi(page, tenant.tenantId, tenant.adminEmail, tenant.adminPassword)
  await page.goto('/projects')

  // Untouched form: Escape closes straight away.
  await page.getByRole('button', { name: 'New Project' }).click()
  const dialog = page.getByRole('dialog', { name: 'New Project' })
  await expect(dialog).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()

  // Edited form: Escape opens the prompt; "Keep editing" returns with the text intact.
  await page.getByRole('button', { name: 'New Project' }).click()
  await dialog.locator('#name').fill('Half finished project')
  await page.keyboard.press('Escape')
  const prompt = page.getByRole('alertdialog')
  await expect(prompt.getByText('Discard unsaved changes?')).toBeVisible()
  await prompt.getByRole('button', { name: 'Keep editing' }).click()
  await expect(prompt).toBeHidden()
  await expect(dialog.locator('#name')).toHaveValue('Half finished project')

  // The X button asks too; Discard closes the dialog.
  await dialog.getByRole('button', { name: 'Close dialog' }).click()
  await expect(prompt).toBeVisible()
  await prompt.getByRole('button', { name: 'Discard' }).click()
  await expect(dialog).toBeHidden()
})

test('data tables have accessible names; inputs that only had a placeholder are labelled', async ({ page, request }) => {
  const tenant = await bootstrapTenant(request, 'PhaseF')
  await loginViaUi(page, tenant.tenantId, tenant.adminEmail, tenant.adminPassword)
  await page.goto('/projects')
  await page.getByRole('button', { name: 'New Project' }).click()
  const dialog = page.getByRole('dialog', { name: 'New Project' })
  await dialog.locator('#name').fill('Labelled Inputs Project')
  await dialog.locator('#domain').selectOption('Motor')
  await dialog.locator('#priority').selectOption('High')
  await dialog.locator('#manager_name').fill('Jane Manager')
  await dialog.locator('#start_date').fill('2026-01-01')
  await dialog.locator('#end_date').fill('2026-12-31')
  await dialog.locator('#budget').fill('1000')
  await dialog.locator('#region').fill('EMEA')
  await dialog.getByRole('button', { name: 'Create Project' }).click()
  await expect(page.getByRole('table', { name: 'Projects' })).toBeVisible({ timeout: 10000 })

  await page.getByRole('link', { name: 'Labelled Inputs Project' }).click()
  for (const name of ['New build name', 'New release name', 'New suite name', 'New plan name']) {
    await expect(page.getByRole('textbox', { name })).toBeVisible()
  }

  await page.goto('/defects')
  await expect(page.getByRole('table', { name: 'Defects' })).toBeVisible()
  await page.goto('/admin/audit-logs')
  await expect(page.getByRole('table', { name: 'Audit log events' })).toBeVisible({ timeout: 10000 })
  await page.goto('/admin/roles')
  await expect(page.getByRole('table', { name: 'Permission matrix' })).toBeVisible({ timeout: 10000 })
})

test('phone cards: links and buttons inside a card are 44px tall', async ({ page, request }) => {
  const tenant = await bootstrapTenant(request, 'PhaseF')
  await loginViaUi(page, tenant.tenantId, tenant.adminEmail, tenant.adminPassword)
  await page.goto('/projects')
  await page.getByRole('button', { name: 'New Project' }).click()
  const dialog = page.getByRole('dialog', { name: 'New Project' })
  await dialog.locator('#name').fill('Card Links Project')
  await dialog.locator('#manager_name').fill('Jane Manager')
  await dialog.locator('#start_date').fill('2026-01-01')
  await dialog.locator('#end_date').fill('2026-12-31')
  await dialog.locator('#budget').fill('1000')
  await dialog.locator('#region').fill('EMEA')
  await dialog.getByRole('button', { name: 'Create Project' }).click()
  await expect(page.getByRole('link', { name: 'Card Links Project' })).toBeVisible({ timeout: 10000 })

  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/projects')
  await expect(page.locator('.qth-card').first()).toBeVisible()
  const small = await page.evaluate(() => {
    const out: string[] = []
    for (const el of document.querySelectorAll('.qth-card a, .qth-card button')) {
      const r = (el as HTMLElement).getBoundingClientRect()
      if (r.width && r.height < 43.5) out.push(`${el.tagName} ${Math.round(r.height)}`)
    }
    return out
  })
  expect(small).toEqual([])
})
