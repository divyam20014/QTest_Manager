import { expect, test, type Page } from '@playwright/test'

import { axeFindings, formatFindings } from './a11y'
import { loginViaUi } from './fixtures'
import { seedRoleTenant } from './roleTenant'

// Redesign step 3: top bar (breadcrumbs, "+ New", notifications) and nav
// (Test Cases label, Defects count badge, single Admin entry).
test.setTimeout(300_000)

const sidebar = (page: Page) => page.getByRole('complementary', { name: 'Sidebar' })

test('top bar and nav at 1280: breadcrumb, + New, bell, Defects badge, Admin entry, Test Cases', async ({
  browser,
  request,
}) => {
  const t = await seedRoleTenant(request, 'TopBar', { withData: true })
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  const page = await ctx.newPage()
  try {
    await loginViaUi(page, t.tenantId, t.adminEmail, t.adminPassword)

    // Renamed label; route unchanged.
    const side = sidebar(page)
    await expect(side.getByRole('link', { name: 'Test Cases' })).toHaveAttribute('href', '/test-repository')
    await expect(side.getByRole('link', { name: 'Test Repository' })).toHaveCount(0)

    // Defects badge: one open defect, announced as "Defects, 1 open".
    await expect(side.getByRole('link', { name: /Defects\s*, 1 open/ })).toBeVisible()

    // Breadcrumb on a project page: parents are links, the current page is aria-current.
    await page.goto(`/projects/${t.projectId}/test-cases`)
    const crumbs = page.getByRole('navigation', { name: 'Breadcrumb' })
    await expect(crumbs.getByRole('link', { name: 'Projects' })).toBeVisible()
    await expect(crumbs.getByRole('link', { name: 'Apex Motor Claims' })).toBeVisible()
    await expect(crumbs.locator('[aria-current="page"]')).toHaveText('Test Cases')
    // Top-level pages do not repeat their own title as a one-item trail.
    await page.goto('/defects')
    await expect(page.getByRole('navigation', { name: 'Breadcrumb' })).toHaveCount(0)

    // + New: opens, lists permitted items, navigates and opens the create dialog.
    await page.goto(`/projects/${t.projectId}`)
    await page.getByRole('button', { name: 'New', exact: true }).click()
    const menu = page.getByRole('menu', { name: 'Create new' })
    await expect(menu.getByRole('menuitem', { name: 'New test case' })).toBeVisible()
    await expect(menu.getByRole('menuitem', { name: 'New test run' })).toBeVisible()
    await expect(menu.getByRole('menuitem', { name: 'New defect' })).toBeVisible()
    await expect(menu.getByRole('menuitem', { name: 'New project' })).toBeVisible()
    await expect(menu.getByRole('menuitem', { name: 'New requirement' })).toBeVisible()
    await menu.getByRole('menuitem', { name: 'New test run' }).click()
    await expect(page).toHaveURL(new RegExp(`/projects/${t.projectId}/test-runs`))
    await expect(page.getByRole('dialog', { name: 'New Test Run' })).toBeVisible()
    await page.keyboard.press('Escape')

    // Bell: opens a list (or empty state) and closes on Escape.
    await page.getByRole('button', { name: /^Notifications/ }).click()
    const panel = page.getByRole('region', { name: 'Notifications' })
    await expect(panel).toBeVisible()
    await expect(panel.getByText(/all caught up|Could not load/).or(panel.getByRole('list'))).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(panel).toBeHidden()

    // Single Admin entry, active on every admin route; every admin page still reachable.
    await expect(side.getByRole('link', { name: 'Users & Roles' })).toHaveCount(0)
    await expect(side.getByRole('link', { name: 'Admin' })).toHaveCount(1)
    await side.getByRole('link', { name: 'Admin' }).click()
    await expect(page).toHaveURL(/\/admin\/users$/)
    const adminNav = page.getByRole('navigation', { name: 'Admin sections' })
    for (const [name, url] of [
      ['Access control', /\/admin\/roles$/],
      ['Environments', /\/admin\/environments$/],
      ['Audit Logs', /\/admin\/audit-logs$/],
      ['Settings', /\/settings$/],
      ['Users & Roles', /\/admin\/users$/],
    ] as const) {
      await adminNav.getByRole('link', { name }).click()
      await expect(page).toHaveURL(url)
      await expect(side.getByRole('link', { name: 'Admin' })).toHaveAttribute('aria-current', 'page')
    }

    // Collapsed rail keeps the accessible name with the count.
    await page.goto('/')
    await page.getByRole('button', { name: 'Collapse sidebar' }).click()
    await expect(side.getByRole('link', { name: /Defects\s*, 1 open/ })).toBeVisible()
    await page.getByRole('button', { name: 'Expand sidebar' }).click()

    expect(formatFindings('topbar-1280', await axeFindings(page))).toEqual([])
  } finally {
    await ctx.close()
  }
})

test('top bar at 390: current-page-only breadcrumb, + New icon, Test Cases tab', async ({ browser, request }) => {
  const t = await seedRoleTenant(request, 'TopBarPhone', { withData: true })
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const page = await ctx.newPage()
  try {
    await loginViaUi(page, t.tenantId, t.adminEmail, t.adminPassword)
    await page.goto(`/projects/${t.projectId}/test-cases`)
    const crumbs = page.getByRole('navigation', { name: 'Breadcrumb' })
    await expect(crumbs.locator('[aria-current="page"]')).toHaveText('Test Cases')
    await expect(crumbs.getByRole('link', { name: 'Projects' })).toBeHidden()
    await expect(page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'Projects' })).toBeVisible()
    const plus = page.getByRole('button', { name: 'New', exact: true })
    const box = (await plus.boundingBox())!
    expect(box.width).toBeGreaterThanOrEqual(44)
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth),
    ).toBeLessThanOrEqual(0)
    expect(formatFindings('topbar-390', await axeFindings(page))).toEqual([])
  } finally {
    await ctx.close()
  }
})
