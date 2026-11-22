import { expect, test, type Page } from '@playwright/test'

import { axeFindings, formatFindings } from './a11y'
import { loginViaUi } from './fixtures'
import { seedRoleTenant } from './roleTenant'

// ADR-108/ADR-114: no one-item Help group (User Guide is a footer link above
// Profile) and no Report builder sidebar item (a tab on Reports instead).
test.setTimeout(480_000)

const sidebar = (page: Page) => page.getByRole('complementary', { name: 'Sidebar' })
const noOverflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)

test('nav consolidation: footer User Guide, Reports tab strip, phone sheet, Tester without Reports', async ({
  browser,
  request,
}) => {
  const t = await seedRoleTenant(request, 'NavConsol')
  const adminCtx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  const admin = await adminCtx.newPage()
  const testerCtx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  const tester = await testerCtx.newPage()

  try {
    await loginViaUi(admin, t.tenantId, t.adminEmail, t.adminPassword)
    await admin.goto('/reporting')
    const side = sidebar(admin)

    // Sidebar: no Help group, no Report builder item; User Guide sits above Profile.
    await expect(side.getByText('Help', { exact: true })).toHaveCount(0)
    await expect(side.getByRole('link', { name: 'Report builder' })).toHaveCount(0)
    const docs = side.getByRole('link', { name: 'User Guide' })
    const profile = side.getByRole('link', { name: 'Profile' })
    const docsBox = (await docs.boundingBox())!
    const profileBox = (await profile.boundingBox())!
    expect(docsBox.y).toBeLessThan(profileBox.y)

    // Tab strip on Reports; axe at 1280.
    const tabs = admin.getByRole('navigation', { name: 'Report sections' })
    await expect(tabs.getByRole('link', { name: 'Overview', exact: true })).toHaveAttribute('aria-current', 'page')
    expect(formatFindings('reporting-1280', await axeFindings(admin))).toEqual([])
    await admin.screenshot({ path: 'test-results/nav-consolidation-1280.png' })

    // Builder via the tab; the Reports sidebar item stays active; deep link works.
    await tabs.getByRole('link', { name: 'Report builder' }).click()
    await expect(admin).toHaveURL(/\/reporting\/builder$/)
    await expect(admin.getByRole('heading', { name: 'Report builder' })).toBeVisible()
    await expect(side.getByRole('link', { name: 'Reports', exact: true })).toHaveAttribute('aria-current', 'page')
    await admin.goto('/reporting/builder')
    await expect(admin.getByRole('navigation', { name: 'Report sections' })).toBeVisible()
    await admin
      .getByRole('navigation', { name: 'Report sections' })
      .getByRole('link', { name: 'Overview', exact: true })
      .click()
    await expect(admin).toHaveURL(/\/reporting$/)

    // User Guide footer link navigates and shows active.
    await docs.click()
    await expect(admin).toHaveURL(/\/user-guide/)
    await expect(docs).toHaveAttribute('aria-current', 'page')

    // Command palette still offers Report builder and User Guide.
    await admin.keyboard.press('Control+k')
    await admin.getByLabel('Command palette search').fill('Report builder')
    await expect(
      admin.getByRole('dialog', { name: 'Command palette' }).getByText('Report builder', { exact: true }),
    ).toBeVisible()
    await admin.keyboard.press('Escape')

    // Collapsed rail: tooltip on keyboard focus.
    await admin.getByRole('button', { name: 'Collapse sidebar' }).click()
    await side.getByRole('link', { name: 'User Guide' }).focus()
    await expect(admin.getByRole('tooltip', { name: 'User Guide' })).toBeVisible()
    await admin.getByRole('button', { name: 'Expand sidebar' }).click()

    // Phone: axe, no overflow, User Guide in the More sheet.
    await admin.setViewportSize({ width: 390, height: 844 })
    await admin.goto('/reporting')
    await expect(admin.getByRole('navigation', { name: 'Report sections' })).toBeVisible()
    expect(await noOverflow(admin)).toBeLessThanOrEqual(0)
    expect(formatFindings('reporting-390', await axeFindings(admin))).toEqual([])
    await admin.screenshot({ path: 'test-results/nav-consolidation-390.png' })
    await admin.getByRole('button', { name: 'More' }).click()
    await expect(admin.getByRole('dialog', { name: 'More' }).getByRole('link', { name: 'User Guide' })).toBeVisible()

    // Tester with Reports hidden: no tab strip route, no Reports link.
    await admin.setViewportSize({ width: 1280, height: 800 })
    await admin.goto('/settings')
    await admin.getByRole('tab', { name: 'Data' }).click()
    await admin.getByLabel(/Hide Reports from Testers/).click()
    await expect(admin.getByLabel(/Hide Reports from Testers/)).toBeChecked()
    await loginViaUi(tester, t.tenantId, t.tester.email, t.tester.password)
    await tester.goto('/reporting')
    await expect(tester.getByRole('navigation', { name: 'Report sections' })).toHaveCount(0)
    await tester.goto('/reporting/builder')
    await expect(tester.getByRole('navigation', { name: 'Report sections' })).toHaveCount(0)
    await expect(tester.getByRole('heading', { name: 'Report builder' })).toHaveCount(0)
    await expect(sidebar(tester).getByRole('link', { name: 'User Guide' })).toBeVisible()
  } finally {
    await adminCtx.close()
    await testerCtx.close()
  }
})

// ADR-108 follow-up: Roles & Permissions and Access rules share one sidebar item
// ("Access control") with a two-tab strip; both routes and permissions are unchanged.
test('Access control: one sidebar item, tab strip on both pages, hidden from a Manager', async ({
  browser,
  request,
}) => {
  const t = await seedRoleTenant(request, 'AccessCtl')
  const adminCtx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  const admin = await adminCtx.newPage()
  const managerCtx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  const manager = await managerCtx.newPage()

  try {
    await loginViaUi(admin, t.tenantId, t.adminEmail, t.adminPassword)
    await admin.goto('/admin/roles')
    const side = sidebar(admin)
    // One "Admin" entry (no separate admin items), active on every admin route.
    await expect(side.getByRole('link', { name: 'Admin' })).toHaveCount(1)
    await expect(side.getByRole('link', { name: 'Access control' })).toHaveCount(0)
    await expect(side.getByRole('link', { name: 'Roles & Permissions' })).toHaveCount(0)
    await expect(side.getByRole('link', { name: 'Admin' })).toHaveAttribute('aria-current', 'page')

    // Tab strip works both ways; the sidebar item is active on both routes.
    const tabs = admin.getByRole('navigation', { name: 'Access control sections' })
    await expect(tabs.getByRole('link', { name: 'Roles & Permissions' })).toHaveAttribute('aria-current', 'page')
    await tabs.getByRole('link', { name: 'Access rules' }).click()
    await expect(admin).toHaveURL(/\/admin\/access-rules$/)
    await expect(admin.getByRole('heading', { name: 'Access rules' })).toBeVisible()
    await expect(side.getByRole('link', { name: 'Admin' })).toHaveAttribute('aria-current', 'page')
    expect(formatFindings('access-rules-1280', await axeFindings(admin))).toEqual([])
    await admin.screenshot({ path: 'test-results/access-control-1280.png' })
    await tabs.getByRole('link', { name: 'Roles & Permissions' }).click()
    await expect(admin).toHaveURL(/\/admin\/roles$/)

    // Palette still finds Access Rules.
    await admin.keyboard.press('Control+k')
    await admin.getByLabel('Command palette search').fill('Access Rules')
    await expect(
      admin.getByRole('dialog', { name: 'Command palette' }).getByText('Access Rules', { exact: true }),
    ).toBeVisible()
    await admin.keyboard.press('Escape')

    // Phone: strip, axe, no overflow, one item in the More sheet.
    await admin.setViewportSize({ width: 390, height: 844 })
    await admin.goto('/admin/access-rules')
    await expect(admin.getByRole('navigation', { name: 'Access control sections' })).toBeVisible()
    expect(await noOverflow(admin)).toBeLessThanOrEqual(0)
    expect(formatFindings('access-rules-390', await axeFindings(admin))).toEqual([])
    await admin.getByRole('button', { name: 'More' }).click()
    const more = admin.getByRole('dialog', { name: 'More' })
    await expect(more.getByRole('link', { name: 'Admin' })).toHaveCount(1)
    await expect(more.getByRole('link', { name: 'Access Rules' })).toHaveCount(0)

    // A Manager reaches only Environments: the Admin item lands there, no Access control tabs.
    await loginViaUi(manager, t.tenantId, t.manager.email, t.manager.password)
    await expect(sidebar(manager).getByRole('link', { name: 'Admin' })).toHaveAttribute('href', '/admin/environments')
    await expect(sidebar(manager).getByRole('link', { name: 'Access control' })).toHaveCount(0)
    await manager.goto('/admin/roles')
    await expect(manager.getByRole('navigation', { name: 'Access control sections' })).toHaveCount(0)
  } finally {
    await adminCtx.close()
    await managerCtx.close()
  }
})
