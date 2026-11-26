import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test'

import { axeFindings, formatFindings } from './a11y'
import { API_BASE_URL, loginViaUi } from './fixtures'
import { seedRoleTenant, type RoleTenant } from './roleTenant'

// ADR-125: the admin Workspace page changes the tenant defaults and a Manager and a Tester of the
// same tenant really see them: sidebar entries and order, project tabs, list view switches. Core
// entries cannot be hidden (UI and API), a project's own tab setup still wins, Reset restores
// everything, and a non-admin has neither the menu entry nor the API. One throwaway tenant.
// Set WORKSPACE_SHOTS_DIR to also write screenshots.

const SHOTS = process.env.WORKSPACE_SHOTS_DIR

let t: RoleTenant

test.describe.configure({ mode: 'serial' })

test.beforeAll(async ({ request }) => {
  test.setTimeout(300_000)
  t = await seedRoleTenant(request, 'Workspace', { withData: true })
})

async function newPage(
  browser: Browser,
  viewport = { width: 1280, height: 800 },
  theme: 'light' | 'dark' = 'light',
): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser.newContext({ viewport, colorScheme: theme })
  await ctx.addInitScript((value) => {
    try {
      localStorage.setItem('qtesthub:theme', value)
    } catch {
      // storage unavailable: the page still renders in the default theme
    }
  }, theme)
  return { ctx, page: await ctx.newPage() }
}

async function signIn(page: Page, who: 'admin' | 'manager' | 'tester') {
  const creds = {
    admin: [t.adminEmail, t.adminPassword],
    manager: [t.manager.email, t.manager.password],
    tester: [t.tester.email, t.tester.password],
  }[who]
  await loginViaUi(page, t.tenantId, creds[0], creds[1])
}

async function shot(page: Page, name: string) {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true })
}

// Spinners and skeleton pulses loop forever; only wait for finite animations and a closed dialog.
async function settle(page: Page) {
  await page.waitForFunction(
    () =>
      document.getAnimations().every((a) => a.effect?.getComputedTiming().iterations === Infinity) &&
      document.querySelectorAll('[role="dialog"]').length === 0,
    undefined,
    { timeout: 10_000 },
  )
}

const sidebar = (page: Page) => page.getByRole('complementary', { name: 'Sidebar' })
const tabs = (page: Page) => page.getByRole('navigation', { name: 'Project sections' })
const viewSwitch = (page: Page) => page.getByRole('group', { name: 'View', exact: true })
const sidebarOrder = (page: Page) =>
  sidebar(page)
    .getByRole('link')
    .allInnerTexts()
    .then((names) => names.map((n) => n.replace(/\s+/g, ' ').trim()))

async function apiAs(page: Page, method: 'get' | 'put' | 'patch', path: string, data?: unknown) {
  return page.request[method](`${API_BASE_URL}${path}`, data === undefined ? undefined : { data })
}

test('admin changes the defaults on the Workspace page', async ({ browser }) => {
  const { ctx, page } = await newPage(browser)
  await signIn(page, 'admin')
  await sidebar(page).getByRole('link', { name: 'Admin' }).click()
  await page.getByRole('link', { name: 'Workspace' }).first().click()
  await expect(page).toHaveURL(/\/admin\/workspace$/)
  await expect(page.getByRole('heading', { name: 'Workspace', level: 1 })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Save changes' })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Reset to defaults' })).toBeDisabled()
  await shot(page, 'workspace-1280-light')

  // Core entries and core tabs offer no way to hide them.
  for (const name of ['Dashboard', 'Projects', 'My Work', 'Admin']) {
    await expect(page.getByRole('checkbox', { name: `Show ${name}`, exact: true })).toHaveCount(0)
  }
  const tabOrder = page.getByRole('list', { name: 'Project tab order' })
  for (const name of ['Overview', 'Requirements', 'Test Runs', 'Reports', 'Settings']) {
    await expect(tabOrder.getByRole('checkbox', { name: `Show ${name}`, exact: true })).toHaveCount(0)
  }

  const order = page.getByRole('list', { name: 'Sidebar entry order' })
  for (let i = 0; i < 3; i++) await order.getByRole('button', { name: 'Move Defects up' }).click()
  await order.getByRole('checkbox', { name: 'Show Reports', exact: true }).uncheck()
  await page.getByRole('checkbox', { name: 'Show Releases', exact: true }).uncheck()
  await page.getByRole('checkbox', { name: 'Show Team', exact: true }).uncheck()
  await page.getByRole('checkbox', { name: 'Board view for Defects' }).uncheck()
  await page.getByRole('checkbox', { name: 'Calendar view for Test runs' }).uncheck()
  await page.getByRole('button', { name: 'Save changes' }).click()
  await expect(page.getByText('Workspace defaults saved')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Save changes' })).toBeDisabled()

  // The admin's own sidebar follows immediately (the cached query was updated by the save).
  await expect(sidebar(page).getByRole('link', { name: 'Reports', exact: true })).toHaveCount(0)
  await shot(page, 'workspace-saved-sidebar')
  await ctx.close()
})

for (const who of ['manager', 'tester'] as const) {
  test(`${who} sees the new sidebar, project tabs and list views`, async ({ browser }) => {
    const { ctx, page } = await newPage(browser)
    await signIn(page, who)
    // Sidebar: Reports is gone, Defects moved up above Test Cases (DOM and visual order).
    await expect(sidebar(page).getByRole('link', { name: /^Defects/ })).toBeVisible()
    await expect(sidebar(page).getByRole('link', { name: 'Reports', exact: true })).toHaveCount(0)
    const defectsBox = await sidebar(page).getByRole('link', { name: /^Defects/ }).boundingBox()
    const casesBox = await sidebar(page).getByRole('link', { name: 'Test Cases' }).boundingBox()
    expect(defectsBox!.y).toBeLessThan(casesBox!.y)
    expect(await sidebarOrder(page)).not.toContain('Reports')
    if (who === 'manager') await shot(page, 'workspace-manager-sidebar')

    // Project tabs: the tenant default hides Releases and Team; the rest stay.
    await page.goto(`/projects/${t.projectId}`)
    await expect(tabs(page).getByRole('link', { name: 'Overview' })).toBeVisible()
    await expect(tabs(page).getByRole('link', { name: 'Planning' })).toBeVisible()
    await expect(tabs(page).getByRole('link', { name: 'Releases' })).toHaveCount(0)
    await expect(tabs(page).getByRole('link', { name: 'Team' })).toHaveCount(0)

    // List views: no Board on defects (only the list is left, so no switch at all) ...
    await page.goto('/defects')
    await expect(page.getByRole('heading', { name: 'Defects', level: 1 })).toBeVisible()
    await expect(viewSwitch(page)).toHaveCount(0)
    // ... a board but no calendar on runs ...
    await page.goto('/test-runs')
    await expect(viewSwitch(page).getByRole('button', { name: 'Board' })).toBeVisible()
    await expect(viewSwitch(page).getByRole('button', { name: 'Calendar' })).toHaveCount(0)
    // ... and a hand-typed ?view=calendar falls back to the list.
    await page.goto('/test-runs?view=calendar')
    await expect(viewSwitch(page).getByRole('button', { name: 'List' })).toHaveAttribute('aria-pressed', 'true')
    // Test cases keep both views (not changed).
    await page.goto(`/projects/${t.projectId}/test-cases`)
    await expect(viewSwitch(page).getByRole('button', { name: 'Board' })).toBeVisible()
    await ctx.close()
  })
}

test('a project with its own tab setup keeps it over the workspace default', async ({ browser }) => {
  const admin = await newPage(browser)
  await signIn(admin.page, 'admin')
  const set = await apiAs(admin.page, 'patch', `/projects/${t.projectId}`, {
    nav_config: { order: [], hidden: ['activity'] },
  })
  expect(set.ok(), await set.text()).toBeTruthy()
  const { ctx, page } = await newPage(browser)
  await signIn(page, 'manager')
  await page.goto(`/projects/${t.projectId}`)
  await expect(tabs(page).getByRole('link', { name: 'Releases' })).toBeVisible()
  await expect(tabs(page).getByRole('link', { name: 'Team' })).toBeVisible()
  await expect(tabs(page).getByRole('link', { name: 'Activity' })).toHaveCount(0)
  // Clearing the project's own setup returns it to the workspace default.
  const cleared = await apiAs(admin.page, 'patch', `/projects/${t.projectId}`, { nav_config: null })
  expect(cleared.ok(), await cleared.text()).toBeTruthy()
  await page.reload()
  await expect(tabs(page).getByRole('link', { name: 'Activity' })).toBeVisible()
  await expect(tabs(page).getByRole('link', { name: 'Releases' })).toHaveCount(0)
  await ctx.close()
  await admin.ctx.close()
})

test('hiding is cosmetic: a hidden destination still opens by its URL', async ({ browser }) => {
  const { ctx, page } = await newPage(browser)
  await signIn(page, 'manager')
  await page.goto('/reporting')
  await expect(page.getByRole('heading', { name: /Report/i, level: 1 }).first()).toBeVisible()
  await page.goto(`/projects/${t.projectId}/releases`)
  await expect(page.getByTestId('hidden-tab-notice')).toBeVisible()
  await ctx.close()
})

test('the phone menu follows the workspace defaults too', async ({ browser }) => {
  const { ctx, page } = await newPage(browser, { width: 375, height: 800 }, 'dark')
  await signIn(page, 'tester')
  await page.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name: 'More' }).click()
  const sheet = page.getByRole('dialog', { name: 'More' })
  // Reports is hidden by the workspace defaults; what stays is still listed (Defects is a bottom tab).
  await expect(sheet.getByRole('link', { name: 'Reports', exact: true })).toHaveCount(0)
  await expect(sheet.getByRole('link', { name: 'My Work' })).toBeVisible()
  await shot(page, 'workspace-more-375-dark')
  await ctx.close()
})

test('core entries cannot be hidden or unknown ones added through the API either', async ({ browser }) => {
  const { ctx, page } = await newPage(browser)
  await signIn(page, 'admin')
  const before = await (await apiAs(page, 'get', '/settings/workspace')).json()
  for (const body of [
    { sidebar: { order: [], hidden: ['home'] } },
    { sidebar: { order: [], hidden: ['admin'] } },
    { sidebar: { order: ['calendar'], hidden: [] } },
    { project_tabs: { order: [], hidden: ['overview'] } },
    { view_modes: { defects: ['board'] } },
  ]) {
    const res = await apiAs(page, 'put', '/settings/workspace', body)
    expect(res.status(), JSON.stringify(body)).toBe(422)
  }
  expect(await (await apiAs(page, 'get', '/settings/workspace')).json()).toEqual(before)
  await ctx.close()
})

test('a non-admin has no menu entry, no page and no write access', async ({ browser }) => {
  for (const who of ['manager', 'tester'] as const) {
    const { ctx, page } = await newPage(browser)
    await signIn(page, who)
    if (who === 'manager') {
      // The Manager reaches the Admin area (Environments) but is not offered Workspace.
      await sidebar(page).getByRole('link', { name: 'Admin' }).click()
      await expect(page.getByRole('link', { name: 'Workspace' })).toHaveCount(0)
    } else {
      await expect(sidebar(page).getByRole('link', { name: 'Admin' })).toHaveCount(0)
    }
    await page.goto('/admin/workspace')
    await expect(page.getByRole('heading', { name: "You don't have access to this page" })).toBeVisible()
    // Reading is open (the shell needs it); changing it is not.
    expect((await apiAs(page, 'get', '/settings/workspace')).status()).toBe(200)
    expect((await apiAs(page, 'put', '/settings/workspace', {})).status()).toBe(403)
    await ctx.close()
  }
})

test('reset restores everything for everyone', async ({ browser }) => {
  const admin = await newPage(browser)
  await signIn(admin.page, 'admin')
  await admin.page.goto('/admin/workspace')
  await expect(admin.page.getByRole('checkbox', { name: 'Show Releases', exact: true })).not.toBeChecked()
  await admin.page.getByRole('button', { name: 'Reset to defaults' }).click()
  await admin.page.getByRole('dialog').getByRole('button', { name: 'Reset to defaults' }).click()
  await expect(admin.page.getByText('Workspace reset to the defaults')).toBeVisible()
  await expect(admin.page.getByRole('checkbox', { name: 'Show Releases', exact: true })).toBeChecked()
  await expect(admin.page.getByRole('button', { name: 'Reset to defaults' })).toBeDisabled()

  const { ctx, page } = await newPage(browser)
  await signIn(page, 'manager')
  await expect(sidebar(page).getByRole('link', { name: 'Reports', exact: true })).toBeVisible()
  await page.goto(`/projects/${t.projectId}`)
  await expect(tabs(page).getByRole('link', { name: 'Releases' })).toBeVisible()
  await expect(tabs(page).getByRole('link', { name: 'Team' })).toBeVisible()
  await page.goto('/defects')
  await expect(viewSwitch(page).getByRole('button', { name: 'Board' })).toBeVisible()
  await ctx.close()
  await admin.ctx.close()
})

test('Workspace page: axe clean, no horizontal scroll, tap targets (light and dark, 4 widths)', async ({ browser }) => {
  const problems: string[] = []
  for (const theme of ['light', 'dark'] as const) {
    const { ctx, page } = await newPage(browser, { width: 1440, height: 900 }, theme)
    await signIn(page, 'admin')
    await page.goto('/admin/workspace')
    for (const width of [1440, 1280, 768, 375]) {
      await page.setViewportSize({ width, height: 900 })
      await expect(page.getByRole('list', { name: 'Sidebar entry order' })).toBeVisible()
      await settle(page)
      await page.waitForTimeout(250)
      problems.push(...formatFindings(`workspace @${width} ${theme}`, await axeFindings(page)))
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
      if (overflow > 0) problems.push(`workspace @${width} ${theme}: horizontal overflow ${overflow}px`)
      if (width === 375) {
        const small = await page.evaluate(() =>
          [...document.querySelectorAll('main button, main input[type="checkbox"]')]
            .map((el) => {
              const target = el.closest('label') ?? el
              const r = target.getBoundingClientRect()
              return { name: el.getAttribute('aria-label') ?? el.textContent, w: r.width, h: r.height }
            })
            .filter((r) => r.h < 40 && r.w < 40 && r.w > 0)
            .map((r) => `${r.name} ${Math.round(r.w)}x${Math.round(r.h)}`),
        )
        if (small.length) problems.push(`workspace @375 ${theme}: small tap targets: ${small.join(', ')}`)
        await shot(page, `workspace-375-${theme}`)
      }
    }
    await ctx.close()
  }
  expect(problems, problems.join('\n')).toEqual([])
})
