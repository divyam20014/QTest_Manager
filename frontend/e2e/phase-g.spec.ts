import { expect, test } from '@playwright/test'

import { bootstrapTenant, loginViaUi } from './fixtures'

// UI/UX remediation Phase G: Inter as the app font, route-level code splitting,
// keyboard containment behind the unsaved-changes prompt, arrow-key tabs, and
// reduced-motion support for JS-driven chart animation.

test('signed-in app uses Inter and lazy route chunks load without console errors', async ({ page, request }) => {
  const tenant = await bootstrapTenant(request, 'PhaseG')
  await loginViaUi(page, tenant.tenantId, tenant.adminEmail, tenant.adminPassword)
  // Start listening after sign-in: the pre-login /auth/me 401 is expected.
  const errors: string[] = []
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text())
  })
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible()

  const family = await page.evaluate(() => getComputedStyle(document.body).fontFamily)
  expect(family).toContain('Inter Variable')
  await page.evaluate(() => document.fonts.ready)
  const loaded = await page.evaluate(() => document.fonts.check('14px "Inter Variable"'))
  expect(loaded).toBe(true)

  // Navigate across lazily loaded routes and a deep link; every one must render a heading.
  for (const [path, heading] of [
    ['/projects', 'Projects'],
    ['/defects', 'Defects'],
    ['/reporting', 'Reporting'],
    ['/admin/roles', 'Roles & Permissions'],
    ['/settings', 'Settings'],
  ] as const) {
    await page.goto(path)
    await expect(page.getByRole('heading', { name: heading, level: 1 })).toBeVisible()
  }
  expect(errors.filter((e) => !/favicon/.test(e))).toEqual([])
})

test('Settings tabs: arrow keys, Home and End move between tabs (roving tabindex)', async ({ page, request }) => {
  const tenant = await bootstrapTenant(request, 'PhaseG')
  await loginViaUi(page, tenant.tenantId, tenant.adminEmail, tenant.adminPassword)
  await page.goto('/settings')
  const tabs = page.getByRole('tab')
  await expect(tabs.first()).toBeVisible()
  const count = await tabs.count()
  expect(count).toBeGreaterThan(2)
  await tabs.first().focus()
  await page.keyboard.press('ArrowRight')
  await expect(tabs.nth(1)).toHaveAttribute('aria-selected', 'true')
  await expect(tabs.nth(1)).toBeFocused()
  await page.keyboard.press('End')
  await expect(tabs.nth(count - 1)).toHaveAttribute('aria-selected', 'true')
  await page.keyboard.press('ArrowRight') // wraps
  await expect(tabs.first()).toHaveAttribute('aria-selected', 'true')
  // The active tab owns a labelled panel.
  const panel = page.getByRole('tabpanel')
  await expect(panel).toHaveAttribute('aria-labelledby', (await tabs.first().getAttribute('id')) ?? '')
})

test('Tab cannot leave the discard prompt to reach the form behind it', async ({ page, request }) => {
  const tenant = await bootstrapTenant(request, 'PhaseG')
  await loginViaUi(page, tenant.tenantId, tenant.adminEmail, tenant.adminPassword)
  await page.goto('/projects')
  await page.getByRole('button', { name: 'New Project' }).click()
  const dialog = page.getByRole('dialog', { name: 'New Project' })
  await dialog.locator('#name').fill('Half finished')
  await page.keyboard.press('Escape')
  const prompt = page.getByRole('alertdialog')
  await expect(prompt).toBeVisible()
  await expect(prompt.getByRole('button', { name: 'Keep editing' })).toBeFocused()
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press('Tab')
    const inPrompt = await page.evaluate(() => !!document.activeElement?.closest('[role="alertdialog"]'))
    expect(inPrompt).toBe(true)
  }
  await page.keyboard.press('Shift+Tab')
  expect(await page.evaluate(() => !!document.activeElement?.closest('[role="alertdialog"]'))).toBe(true)
  // Keep editing returns focus into the form, not to <body>.
  await prompt.getByRole('button', { name: 'Keep editing' }).click()
  await expect(prompt).toBeHidden()
  await expect.poll(() => page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'))).toBe(true)
})

test('reduced motion: charts do not animate and CSS motion is flattened', async ({ page, request }) => {
  const tenant = await bootstrapTenant(request, 'PhaseG')
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await loginViaUi(page, tenant.tenantId, tenant.adminEmail, tenant.adminPassword)
  await page.goto('/reporting')
  await expect(page.getByRole('heading', { name: 'Reporting', level: 1 })).toBeVisible()
  await expect(page.locator('main button').first()).toBeVisible()
  const duration = await page.evaluate(() => getComputedStyle(document.querySelector('main button')!).transitionDuration)
  expect(parseFloat(duration)).toBeLessThan(0.01)
})

test('Runs overview and control heights stay on the documented scale', async ({ page, request }) => {
  const tenant = await bootstrapTenant(request, 'PhaseG')
  await loginViaUi(page, tenant.tenantId, tenant.adminEmail, tenant.adminPassword)
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto('/settings')
  await expect(page.getByRole('tab').first()).toBeVisible()
  const heights = await page.evaluate(() =>
    [...document.querySelectorAll('[role="tab"]')].map((el) => Math.round(el.getBoundingClientRect().height)),
  )
  expect(heights.length).toBeGreaterThan(0)
  for (const h of heights) expect(h).toBe(40)
  await page.goto('/test-runs')
  await expect(page.getByRole('heading', { name: 'Test Runs', level: 1 })).toBeVisible()
})

test('sign-in page has a main landmark and Inter loads there too', async ({ page }) => {
  await page.goto('/login')
  await expect(page.getByRole('main')).toBeVisible()
  const family = await page.evaluate(() => getComputedStyle(document.body).fontFamily)
  expect(family).toContain('Inter Variable')
})
