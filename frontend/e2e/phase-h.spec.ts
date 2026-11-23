import { expect, test, type Page } from '@playwright/test'

import { bootstrapTenant, loginViaUi, createTestCaseViaForm } from './fixtures'

// UI/UX remediation Phase H: keyboard-only walkthroughs of key flows, and
// session handling (logout, protected routes, expired session). All against a
// throwaway tenant; nothing here touches the demo tenant.

async function tabUntil(page: Page, predicate: () => Promise<boolean>, max = 60) {
  for (let i = 0; i < max; i++) {
    if (await predicate()) return i
    await page.keyboard.press('Tab')
  }
  throw new Error('Focus never reached the target within ' + max + ' Tab presses')
}

test('keyboard only: sign in, skip link, sidebar navigation, open and close a dialog', async ({ page, request }) => {
  const tenant = await bootstrapTenant(request, 'PhaseH')

  // Sign-in: every step is reachable and operable with Tab / typing / Enter.
  await page.goto('/login')
  await page.waitForSelector('text=Sign in to your organization')
  await tabUntil(page, () => page.evaluate(() => document.activeElement?.id === 'email'), 10)
  await page.keyboard.type(tenant.adminEmail)
  await page.keyboard.press('Enter')
  await page.waitForSelector('#password')
  await tabUntil(page, () => page.evaluate(() => document.activeElement?.id === 'password'), 10)
  await page.keyboard.type(tenant.adminPassword)
  await page.keyboard.press('Enter')
  await page.waitForSelector('text=Enter your verification code')
  const code = (await page.textContent('body'))?.match(/Dev mode code:\s*(\d{6})/)?.[1]
  expect(code).toBeTruthy()
  await tabUntil(page, () => page.evaluate(() => document.activeElement?.id === 'code'), 10)
  await page.keyboard.type(code!)
  await page.keyboard.press('Enter')
  await expect(page.getByRole('heading', { name: 'Dashboard', level: 1 })).toBeVisible()

  // The first Tab stop is the skip link; activating it moves focus to <main>.
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
  await page.keyboard.press('Tab')
  await expect(page.getByRole('link', { name: 'Skip to main content' })).toBeFocused()
  await page.keyboard.press('Enter')
  expect(await page.evaluate(() => document.activeElement?.id)).toBe('main-content')

  // Sidebar: reach "Projects" by Tab alone and open it with Enter.
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
  await tabUntil(page, () =>
    page.evaluate(() => {
      const a = document.activeElement as HTMLAnchorElement | null
      return !!a && a.tagName === 'A' && a.textContent?.trim() === 'Projects' && !!a.closest('aside')
    }),
  )
  await page.keyboard.press('Enter')
  await expect(page.getByRole('heading', { name: 'Projects', level: 1 })).toBeVisible()

  // Dialog: open "New Project" from the keyboard, Escape closes it, focus returns to the trigger.
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
  await tabUntil(page, () =>
    page.evaluate(() => (document.activeElement as HTMLElement | null)?.textContent?.trim() === 'New Project'),
  )
  await page.keyboard.press('Enter')
  const dialog = page.getByRole('dialog', { name: 'New Project' })
  await expect(dialog).toBeVisible()
  expect(await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'))).toBe(true)
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await expect(page.getByRole('button', { name: 'New Project' })).toBeFocused()
})

async function createApprovedTwoStepCase(page: Page) {
  await page.click('a:has-text("Projects")')
  await page.click('button:has-text("New Project")')
  await page.waitForSelector('text=New Project')
  await page.fill('#name', 'Keyboard Run Project')
  await page.selectOption('#domain', 'Motor')
  await page.selectOption('#priority', 'High')
  await page.fill('#manager_name', 'Jane Manager')
  await page.fill('#start_date', '2026-01-01')
  await page.fill('#end_date', '2026-12-31')
  await page.fill('#budget', '450000')
  await page.fill('#region', 'North America')
  await page.click('button:has-text("Create Project")')
  await page.click('a:has-text("Keyboard Run Project")')
  await page.click('nav[aria-label="Project sections"] >> text=Details')
  await page.waitForSelector('text=Team Members')
  await page.click('nav[aria-label="Project sections"] >> text=Test Cases')
  await page.click('button:has-text("New Test Case")')
  await page.waitForSelector('text=New Test Case')
  await createTestCaseViaForm(page, {
    title: 'Keyboard executed case',
    priority: 'Critical',
    steps: [{ action: 'Open the page', expected: 'Page opens' }, { action: 'Submit the form', expected: 'Form is saved' }],
  })
  await expect(page.getByRole('link', { name: 'Keyboard executed case' })).toBeVisible({ timeout: 10000 })
  await page.click('a:has-text("Keyboard executed case")')
  await page.waitForSelector('text=Steps')
  await page.click('button:has-text("Submit for Review")')
  await page.click('div[role="dialog"] button:has-text("Submit")')
  await expect(page.getByText('Ready for Review').first()).toBeVisible({ timeout: 10000 })
  await page.click('button:has-text("Approve")')
  await expect(page.getByRole('button', { name: 'Edit' })).toBeVisible({ timeout: 10000 })
}

test('keyboard only: run a case with P and F, file the defect from the keyboard', async ({ page, request }) => {
  const tenant = await bootstrapTenant(request, 'PhaseH')
  await loginViaUi(page, tenant.tenantId, tenant.adminEmail, tenant.adminPassword)
  await createApprovedTwoStepCase(page)
  await page.click('a:has-text("← Test Cases")')
  await page.waitForSelector('text=Keyboard executed case', { timeout: 10000 })
  await page.click('a:has-text("← Keyboard Run Project")')
  await page.click('nav[aria-label="Project sections"] >> text=Details')
  await page.waitForSelector('text=Team Members', { timeout: 10000 })
  await page.click('main a:has-text("Test Runs")')
  await page.click('button:has-text("New Test Run")')
  await page.waitForSelector('text=New Test Run')
  await page.fill('#run-name', 'Keyboard run')
  await page.click('li label:has-text("Keyboard executed case")')
  await page.click('button:has-text("Create Test Run")')
  await expect(page.getByRole('link', { name: 'Execute' })).toBeVisible({ timeout: 10000 })
  await page.click('a:has-text("Execute")')
  await page.waitForSelector('text=Execution Console', { timeout: 10000 })

  // Make sure focus is on the page, not in a field, then use only the shortcuts.
  const verdictBar = page.getByRole('group', { name: 'Record a verdict for the current step' })
  await expect(verdictBar.getByText('Step 1: Open the page')).toBeVisible({ timeout: 15000 })
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
  await page.keyboard.press('p')
  await expect(verdictBar.getByText('Step 2: Submit the form')).toBeVisible({ timeout: 10000 })
  await page.fill('#actual-result', 'The form was not saved')
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
  await page.keyboard.press('f')
  await expect(page.getByRole('heading', { name: 'Report Defect' })).toBeVisible({ timeout: 10000 })
  // Inside the defect dialog: operate every control from the keyboard.
  const dialog = page.getByRole('dialog')
  await dialog.locator('#defect-severity').focus()
  // Severity has no default: open the list, Arrow Down to Critical (after Low, Medium, High), Enter chooses it.
  await page.keyboard.press('Enter')
  // The severities load with the dialog; wait for them before arrowing through the list.
  await expect(page.getByRole('option', { name: 'Critical' })).toBeVisible()
  for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Enter')
  await expect(dialog.getByRole('combobox', { name: /Severity/ })).toContainText('Critical')
  await dialog.locator('#defect-description').focus()
  await page.keyboard.press('Control+A')
  await page.keyboard.type('Form was not saved')
  // The case has no environment, and a defect needs one.
  await dialog.locator('#defect-environment').focus()
  await page.keyboard.type('QA')
  await tabUntil(page, () =>
    page.evaluate(() => (document.activeElement as HTMLElement | null)?.textContent?.trim() === 'Report Defect'),
  )
  await page.keyboard.press('Enter')
  await expect(page.getByRole('heading', { name: 'Report Defect' })).toBeHidden({ timeout: 10000 })
  await expect(page.getByText('Failed').first()).toBeVisible({ timeout: 10000 })
})

test('typing P, F or I in a text field does not record a verdict', async ({ page, request }) => {
  const tenant = await bootstrapTenant(request, 'PhaseH')
  await loginViaUi(page, tenant.tenantId, tenant.adminEmail, tenant.adminPassword)
  await createApprovedTwoStepCase(page)
  await page.click('a:has-text("← Test Cases")')
  await page.waitForSelector('text=Keyboard executed case', { timeout: 10000 })
  await page.click('a:has-text("← Keyboard Run Project")')
  await page.click('main a:has-text("Test Runs")')
  await page.click('button:has-text("New Test Run")')
  await page.fill('#run-name', 'Guard run')
  await page.click('li label:has-text("Keyboard executed case")')
  await page.click('button:has-text("Create Test Run")')
  await page.click('a:has-text("Execute")')
  await page.waitForSelector('text=Execution Console', { timeout: 10000 })
  const verdictBar = page.getByRole('group', { name: 'Record a verdict for the current step' })
  await expect(verdictBar.getByText('Step 1: Open the page')).toBeVisible({ timeout: 15000 })
  // Type the three shortcut letters into a text field in the console (the step comment box).
  await page.getByText('Comments', { exact: true }).first().click().catch(() => {})
  const field = page.locator('main textarea, main input[type="text"]').first()
  await expect(field).toBeVisible({ timeout: 5000 })
  await field.focus()
  await page.keyboard.type('pif')
  await expect(field).toHaveValue('pif')
  // Still on step 1, and no defect dialog: nothing was recorded.
  await expect(verdictBar.getByText('Step 1: Open the page')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Report Defect' })).toHaveCount(0)
})

test('session: logout, protected routes and an expired session send the user to sign-in', async ({ page, request, context }) => {
  const tenant = await bootstrapTenant(request, 'PhaseH')
  await loginViaUi(page, tenant.tenantId, tenant.adminEmail, tenant.adminPassword)
  // Sign out through the account menu.
  await page.getByRole('button', { name: /account menu/i }).click()
  await page.getByRole('button', { name: 'Logout' }).click()
  await expect(page).toHaveURL(/\/login/)
  // Protected routes bounce an anonymous visitor.
  await page.goto('/projects')
  await expect(page).toHaveURL(/\/login/)
  await page.goto('/admin/users')
  await expect(page).toHaveURL(/\/login/)

  // Expired session: sign in, drop every cookie, reload.
  await loginViaUi(page, tenant.tenantId, tenant.adminEmail, tenant.adminPassword)
  await page.goto('/projects')
  await expect(page.getByRole('heading', { name: 'Projects', level: 1 })).toBeVisible()
  await context.clearCookies()
  await page.reload()
  await expect(page).toHaveURL(/\/login/)
})
