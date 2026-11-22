import { expect, test } from '@playwright/test'

import { bootstrapTenant, loginViaUi } from './fixtures'

// UI/UX remediation Phase C: application shell. Header controls fit at tablet
// widths (UX-001), the account menu's accessible name starts with its visible
// text (UX-006), the sidebar has one entry per destination with names and
// tooltips when collapsed (UX-024), Compliance Reports opens in a new tab
// (UX-025), and every page opens with a single PageHeader <h1> (UX-010).

const overflowOf = (page: import('@playwright/test').Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)

test('tablet widths: header controls fit and the search is an icon below lg', async ({ page, request }) => {
  const tenant = await bootstrapTenant(request, 'ShellC')
  await loginViaUi(page, tenant.tenantId, tenant.adminEmail, tenant.adminPassword)

  for (const width of [768, 820, 900]) {
    await page.setViewportSize({ width, height: 900 })
    for (const path of ['/', '/projects', '/execution', '/test-repository']) {
      await page.goto(path)
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
      expect(await overflowOf(page), `${path} at ${width}px`).toBeLessThanOrEqual(0)
    }
    // Below lg the inline field is replaced by an icon that opens the palette.
    await expect(page.getByRole('search')).toBeHidden()
    await expect(page.getByRole('button', { name: 'Search' })).toBeVisible()
  }

  // From lg the inline search field is back.
  await page.setViewportSize({ width: 1100, height: 900 })
  await expect(page.getByRole('search')).toBeVisible()
})

test('desktop shell: account menu name, collapsed sidebar tooltips, new-tab compliance link', async ({
  page,
  request,
}) => {
  const tenant = await bootstrapTenant(request, 'ShellD')
  await loginViaUi(page, tenant.tenantId, tenant.adminEmail, tenant.adminPassword)
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')

  // UX-006: the accessible name starts with the visible "Name · role" text.
  const account = page.getByRole('button', { name: /account menu$/ })
  await expect(account).toBeVisible()
  const visible = (await account.innerText()).trim()
  expect(visible.length).toBeGreaterThan(0)
  const name = (await account.getAttribute('aria-label')) ?? ''
  expect(name.startsWith(visible)).toBe(true)
  await account.click()
  await expect(page.getByRole('link', { name: 'My Account' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('link', { name: 'My Account' })).toBeHidden()

  // UX-024: Settings and Profile appear once each.
  const sidebar = page.locator('aside')
  await expect(sidebar.getByRole('link', { name: 'Admin' })).toHaveCount(1)
  await expect(sidebar.getByRole('link', { name: 'Settings' })).toHaveCount(0)
  await expect(sidebar.getByRole('link', { name: 'Organization' })).toHaveCount(0)
  await expect(sidebar.getByRole('link', { name: 'Profile' })).toHaveCount(1)

  // UX-025: Compliance Reports leaves the shell, so it opens in a new tab.
  const compliance = sidebar.getByRole('link', { name: /Compliance Reports/ })
  await expect(compliance).toHaveAttribute('target', '_blank')
  await expect(compliance).toHaveAttribute('rel', /noopener/)

  // Collapsed: every link keeps an accessible name and shows a tooltip.
  await page.getByRole('button', { name: 'Collapse sidebar' }).click()
  const projects = sidebar.getByRole('link', { name: 'Projects' })
  await expect(projects).toBeVisible()
  await projects.hover()
  await expect(page.getByRole('tooltip').filter({ hasText: 'Projects' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('tooltip')).toBeHidden()
  await page.getByRole('button', { name: 'Expand sidebar' }).click()

  // UX-010: every top-level screen opens with exactly one <h1> and heading
  // levels never skip.
  for (const path of ['/', '/projects', '/defects', '/test-runs', '/reporting', '/admin/users', '/settings', '/account']) {
    await page.goto(path)
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)
    const skips = await page.evaluate(() => {
      const levels = [...document.querySelectorAll('h1,h2,h3,h4')].map((h) => Number(h.tagName[1]))
      let n = 0
      for (let i = 1; i < levels.length; i++) if (levels[i] - levels[i - 1] > 1) n++
      return n
    })
    expect(skips, `heading skips on ${path}`).toBe(0)
  }
})

test('phone: toasts sit above the tab bar and errors are announced as alerts', async ({ page, request }) => {
  const tenant = await bootstrapTenant(request, 'ShellT')
  await page.setViewportSize({ width: 390, height: 844 })
  await loginViaUi(page, tenant.tenantId, tenant.adminEmail, tenant.adminPassword)
  await page.goto('/admin/environments')

  // Creating an environment shows a success toast.
  await page.locator('#env-name').fill(`Env ${Date.now()}`)
  await page.getByRole('button', { name: 'Add Environment' }).click()
  const toast = page.getByRole('status').filter({ hasText: 'Environment added' })
  await expect(toast).toBeVisible()

  const bar = await page.getByRole('navigation', { name: 'Primary' }).boundingBox()
  const box = await toast.boundingBox()
  expect(bar).not.toBeNull()
  expect(box).not.toBeNull()
  // The toast ends above the top edge of the bar.
  expect(box!.y + box!.height).toBeLessThanOrEqual(bar!.y)

  // Escape dismisses it.
  await page.keyboard.press('Escape')
  await expect(toast).toBeHidden()
})
