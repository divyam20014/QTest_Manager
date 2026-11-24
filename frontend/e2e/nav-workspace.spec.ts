import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test'

import { axeFindings, formatFindings, settle } from './a11y'
import { API_BASE_URL, loginViaUi, seedCaseBody } from './fixtures'
import { seedRoleTenant, type RoleTenant } from './roleTenant'

// ADR-121 (phase 2): the data-driven sidebar (groups, remembered state, rail flyouts),
// favourites and recent, My Work, and the calm top bar. One throwaway tenant, seeded once.
test.setTimeout(480_000)
test.describe.configure({ mode: 'serial' })

const SHOTS = process.env.NAV_SHOTS_DIR

let t: RoleTenant & { reviewCaseId: string }

const sidebar = (page: Page) => page.getByRole('complementary', { name: 'Sidebar' })
const overflowOf = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)

async function shot(page: Page, name: string) {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` })
}

async function newPage(
  browser: Browser,
  viewport: { width: number; height: number },
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

test.beforeAll(async ({ playwright }) => {
  const request = await playwright.request.newContext()
  const seeded = await seedRoleTenant(request, 'NavWs', { withData: true })
  const login = await request.post(`${API_BASE_URL}/auth/login`, {
    data: { tenant_id: seeded.tenantId, email: seeded.adminEmail, password: seeded.adminPassword },
  })
  const verify = await request.post(`${API_BASE_URL}/auth/mfa/verify`, {
    data: { code: (await login.json()).data.debug_code },
  })
  expect(verify.ok()).toBeTruthy()
  const call = async (method: 'post' | 'patch', path: string, data: unknown) => {
    const res = await request[method](`${API_BASE_URL}${path}`, { data })
    expect(res.ok(), `${path}: ${await res.text()}`).toBeTruthy()
    return (await res.json()).data
  }
  // The tester has a run case and a defect assigned; the manager has a case to review.
  await call('patch', `/test-run-cases/${seeded.runCaseId}/assign`, { assigned_to: seeded.tester.id })
  await call('patch', `/defects/${seeded.defectId}`, { assigned_to: seeded.tester.id })
  const review = await call(
    'post',
    `/projects/${seeded.projectId}/test-cases`,
    await seedCaseBody(request, seeded.projectId!, { title: 'Awaiting manager review' }),
  )
  await call('post', `/test-cases/${review.id}/submit-review`, { reviewer_id: seeded.manager.id })
  await request.post(`${API_BASE_URL}/auth/logout`)
  await request.dispose()
  t = { ...seeded, reviewCaseId: review.id }
})

test('sidebar groups are toggle buttons: aria-expanded, remembered, auto-expand, keyboard', async ({ browser }) => {
  const { ctx, page } = await newPage(browser, { width: 1280, height: 800 })
  try {
    await signIn(page, 'admin')
    const side = sidebar(page)
    await shot(page, 'sidebar-1280-light')

    // Headings are buttons, never links; the leaves keep their names.
    const exec = side.getByRole('button', { name: 'Test Execution' })
    await expect(side.getByRole('link', { name: 'Test Execution' })).toHaveCount(0)
    await expect(exec).toHaveAttribute('aria-expanded', 'true')
    await expect(side.getByRole('link', { name: 'Test Runs' })).toBeVisible()
    await expect(side.getByRole('link', { name: 'Execution Console' })).toBeVisible()
    await expect(side.getByRole('link', { name: 'My Work' })).toHaveAttribute('href', '/my-work')
    // Nothing without a page behind it.
    for (const name of ['Calendar', 'Documents', 'Test Automation', 'Releases']) {
      await expect(side.getByText(name, { exact: true })).toHaveCount(0)
    }

    // Close it: the leaves go, the state survives a reload.
    await exec.click()
    await expect(exec).toHaveAttribute('aria-expanded', 'false')
    await expect(side.getByRole('link', { name: 'Test Runs' })).toBeHidden()
    await page.reload()
    await expect(side.getByRole('button', { name: 'Test Execution' })).toHaveAttribute('aria-expanded', 'false')

    // Arriving at a page inside the group opens it, and the current leaf says so.
    await page.goto('/test-runs')
    await expect(exec).toHaveAttribute('aria-expanded', 'true')
    await expect(side.getByRole('link', { name: 'Test Runs' })).toHaveAttribute('aria-current', 'page')
    await expect(side.getByRole('link', { name: 'Execution Console' })).not.toHaveAttribute('aria-current', 'page')
    // Only one entry is current at a time.
    await expect(side.locator('[aria-current="page"]')).toHaveCount(1)
    await shot(page, 'sidebar-1280-light-active-group')

    // Closing the current group by hand sticks until the next navigation.
    await exec.click()
    await expect(exec).toHaveAttribute('aria-expanded', 'false')
    await page.waitForTimeout(300)
    await expect(exec).toHaveAttribute('aria-expanded', 'false')

    // Keyboard: Enter and Space both toggle, focus stays on the toggle.
    const reports = side.getByRole('button', { name: 'Reports & Analytics' })
    await reports.focus()
    await page.keyboard.press('Enter')
    await expect(reports).toHaveAttribute('aria-expanded', 'false')
    await page.keyboard.press('Space')
    await expect(reports).toHaveAttribute('aria-expanded', 'true')
    await expect(reports).toBeFocused()
    await expect(side.getByRole('link', { name: /Compliance Reports/ })).toHaveAttribute('target', '_blank')

    // The old destinations are all still one click away.
    for (const [name, href] of [
      ['Projects', '/projects'],
      ['Test Cases', '/test-repository'],
      ['Defects', '/defects'],
      ['Reports', '/reporting'],
    ] as const) {
      await expect(side.getByRole('link', { name: new RegExp(`^${name}`) })).toHaveAttribute('href', href)
    }
    expect(await overflowOf(page)).toBeLessThanOrEqual(0)
    expect(formatFindings('sidebar groups light', await axeFindings(page))).toEqual([])
  } finally {
    await ctx.close()
  }
})

test('icon rail: groups open a flyout, tooltips, Escape returns focus, keyboard operable', async ({ browser }) => {
  const { ctx, page } = await newPage(browser, { width: 1280, height: 800 })
  try {
    await signIn(page, 'admin')
    await page.getByRole('button', { name: 'Collapse sidebar' }).click()
    const side = sidebar(page)
    await expect.poll(async () => Math.round((await side.boundingBox())!.width)).toBe(64)

    const exec = side.getByRole('button', { name: 'Test Execution' })
    await expect(exec).toHaveAttribute('aria-expanded', 'false')
    await exec.hover()
    await expect(page.getByRole('tooltip', { name: 'Test Execution' })).toBeVisible()

    await exec.click()
    const flyout = page.getByRole('group', { name: 'Test Execution' })
    await expect(exec).toHaveAttribute('aria-expanded', 'true')
    await expect(flyout.getByRole('link', { name: 'Test Runs' })).toBeVisible()
    await expect(flyout.getByRole('link', { name: 'Execution Console' })).toBeVisible()
    await shot(page, 'rail-1280-light-flyout')
    expect(formatFindings('rail flyout', await axeFindings(page))).toEqual([])
    await page.keyboard.press('Escape')
    await expect(flyout).toBeHidden()
    await expect(exec).toBeFocused()

    // Keyboard only: open, Tab into the flyout, Enter on a link navigates and closes it.
    await page.keyboard.press('Enter')
    await expect(flyout).toBeVisible()
    await page.keyboard.press('Tab')
    await expect(flyout.getByRole('link', { name: 'Test Runs' })).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(/\/test-runs$/)
    await expect(flyout).toBeHidden()
    // The rail marks the group holding the current page.
    await expect(side.getByRole('button', { name: 'Test Execution' })).toHaveAttribute('aria-current', 'true')
    // Top-level links keep their name and tooltip in the rail.
    await side.getByRole('link', { name: 'My Work' }).focus()
    await expect(page.getByRole('tooltip', { name: 'My Work' })).toBeVisible()
    await shot(page, 'rail-1280-light')
    expect(await overflowOf(page)).toBeLessThanOrEqual(0)
    expect(Math.round((await side.boundingBox())!.width)).toBe(64)
  } finally {
    await ctx.close()
  }
})

test('favourites and recent: star on detail pages, sidebar areas, order, persistence, remove, per user', async ({
  browser,
}) => {
  const { ctx, page } = await newPage(browser, { width: 1280, height: 800 })
  const other = await newPage(browser, { width: 1280, height: 800 })
  try {
    await signIn(page, 'admin')
    const side = sidebar(page)
    await expect(side.getByRole('region', { name: 'Favourites' })).toHaveCount(0)
    await expect(side.getByRole('region', { name: 'Recent' })).toHaveCount(0)

    // Star a defect.
    await page.goto(`/defects/${t.defectId}`)
    await expect(page.getByRole('heading', { level: 1, name: 'Seeded defect' })).toBeVisible()
    const star = page.getByRole('button', { name: 'Add to favourites' })
    await star.click()
    await expect(page.getByRole('button', { name: 'Remove from favourites' })).toHaveAttribute('aria-pressed', 'true')
    const favourites = side.getByRole('region', { name: 'Favourites' })
    await expect(favourites.getByRole('link', { name: 'Seeded defect' })).toHaveAttribute('href', `/defects/${t.defectId}`)

    // Visits are recorded newest first (test case, run, project).
    await page.goto(`/test-cases/${t.caseId}`)
    await expect(page.getByRole('heading', { level: 1, name: 'Verify settlement' })).toBeVisible()
    await page.goto(`/test-runs/${t.runId}`)
    await expect(page.getByRole('heading', { level: 1, name: 'Sprint run' })).toBeVisible()
    await page.goto(`/projects/${t.projectId}`)
    await expect(page.getByRole('heading', { level: 1, name: 'Apex Motor Claims' })).toBeVisible()
    const recent = side.getByRole('region', { name: 'Recent' })
    await expect(recent.getByRole('link')).toHaveText([
      'Apex Motor Claims',
      'Sprint run',
      'Verify settlement',
      'Seeded defect',
    ])

    // Keyboard: the star is a button in the tab order and Enter toggles it.
    const projectStar = page.getByRole('button', { name: 'Add to favourites' })
    await projectStar.focus()
    await page.keyboard.press('Enter')
    await expect(page.getByRole('button', { name: 'Remove from favourites' })).toBeFocused()
    await expect(favourites.getByRole('link')).toHaveText(['Apex Motor Claims', 'Seeded defect'])
    await shot(page, 'favourites-1280-light')

    // Survives a reload; the section collapses and stays collapsed.
    await page.reload()
    await expect(favourites.getByRole('link')).toHaveText(['Apex Motor Claims', 'Seeded defect'])
    const toggle = favourites.getByRole('button', { name: /^Favourites/ })
    await expect(toggle).toHaveAttribute('aria-expanded', 'true')
    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await expect(favourites.getByRole('link', { name: 'Seeded defect' })).toBeHidden()
    await page.reload()
    await expect(favourites.getByRole('button', { name: /^Favourites/ })).toHaveAttribute('aria-expanded', 'false')
    await favourites.getByRole('button', { name: /^Favourites/ }).click()

    // A stale entry (the record is gone) can be removed by hand.
    const ghost = '00000000-0000-0000-0000-000000000000'
    await page.evaluate((id) => {
      const key = Object.keys(localStorage).find((k) => k.startsWith('qtesthub:favourites:'))!
      const list = JSON.parse(localStorage.getItem(key)!)
      list.unshift({ type: 'defect', id, title: 'Gone defect', url: `/defects/${id}`, at: Date.now() })
      localStorage.setItem(key, JSON.stringify(list))
    }, ghost)
    await page.reload()
    await favourites.getByRole('link', { name: 'Gone defect' }).click()
    await expect(page).toHaveURL(new RegExp(`/defects/${ghost}$`))
    await favourites.getByRole('listitem').filter({ hasText: 'Gone defect' }).getByRole('button', { name: 'Unpin favourite' }).click()
    await expect(favourites.getByRole('link', { name: 'Gone defect' })).toHaveCount(0)
    await favourites.getByRole('listitem').filter({ hasText: 'Seeded defect' }).getByRole('button', { name: 'Unpin favourite' }).click()
    await expect(favourites.getByRole('link', { name: 'Seeded defect' })).toHaveCount(0)

    // Another person on the same machine (another browser profile here) sees none of it.
    await signIn(other.page, 'tester')
    await expect(sidebar(other.page).getByRole('region', { name: 'Favourites' })).toHaveCount(0)
    await expect(sidebar(other.page).getByRole('region', { name: 'Recent' })).toHaveCount(0)

    // Icon rail: both areas become flyouts.
    await page.goto(`/defects/${t.defectId}`)
    await page.getByRole('button', { name: 'Collapse sidebar' }).click()
    await side.getByRole('button', { name: 'Recent' }).click()
    const flyout = page.getByRole('group', { name: 'Recent' })
    await expect(flyout.getByRole('link', { name: 'Seeded defect' })).toBeVisible()
    await shot(page, 'recent-rail-1280-light')
    await page.keyboard.press('Escape')
    await expect(flyout).toBeHidden()
  } finally {
    await ctx.close()
    await other.ctx.close()
  }
})

test('My Work: a tester sees their run cases and defects, a manager their reviews; badges match the data', async ({
  browser,
}) => {
  const tester = await newPage(browser, { width: 1280, height: 800 })
  const manager = await newPage(browser, { width: 1280, height: 800 })
  try {
    // --- tester: one run case and one defect assigned ---------------------------------
    await signIn(tester.page, 'tester')
    const tp = tester.page
    const summary = (await (await tp.request.get(`${API_BASE_URL}/my-work/summary`)).json()).data
    expect(summary.run_cases_total).toBe(1)
    expect(summary.reviews_total).toBe(0)
    // The badge is the API's count, spoken as "1 pending".
    await expect(sidebar(tp).getByRole('link', { name: /^My Work\s*, 1 pending$/ })).toBeVisible()

    await sidebar(tp).getByRole('link', { name: /^My Work/ }).click()
    await expect(tp).toHaveURL(/\/my-work$/)
    await expect(tp.getByRole('heading', { level: 1, name: 'My Work' })).toBeVisible()
    await expect(sidebar(tp).getByRole('link', { name: /^My Work/ })).toHaveAttribute('aria-current', 'page')
    const runTab = tp.getByRole('tab', { name: /^Run cases/ })
    await expect(runTab).toHaveAttribute('aria-selected', 'true')
    await expect(runTab).toContainText('1')
    await expect(tp.getByRole('heading', { level: 2, name: /Failed - retest \(1\)/ })).toBeVisible()
    const runLink = tp.getByRole('link', { name: /Verify settlement/ })
    await expect(runLink).toHaveAttribute('href', new RegExp(`/test-run-cases/${t.runCaseId}\\?runId=${t.runId}$`))
    await shot(tp, 'mywork-1280-light')
    expect(formatFindings('my-work light', await axeFindings(tp))).toEqual([])

    await tp.getByRole('tab', { name: /^Defects/ }).click()
    const defectLink = tp.getByRole('link', { name: /Seeded defect/ })
    await expect(defectLink).toHaveAttribute('href', `/defects/${t.defectId}`)
    await expect(defectLink).toContainText('Assigned to me')
    await tp.getByRole('tab', { name: /^Reviews/ }).click()
    await expect(tp.getByText('Nothing waiting for your review')).toBeVisible()

    // Opening the run case lands in the Execution Console.
    await tp.getByRole('tab', { name: /^Run cases/ }).click()
    await runLink.click()
    await expect(tp).toHaveURL(new RegExp(`/test-run-cases/${t.runCaseId}`))

    // --- manager: a case to review, nothing else --------------------------------------
    await signIn(manager.page, 'manager')
    const mp = manager.page
    const mgr = (await (await mp.request.get(`${API_BASE_URL}/my-work/summary`)).json()).data
    expect(mgr.run_cases_total).toBe(0)
    expect(mgr.reviews_total).toBe(1)
    await expect(sidebar(mp).getByRole('link', { name: /^My Work\s*, 1 pending$/ })).toBeVisible()
    await mp.goto('/my-work?tab=reviews')
    await expect(mp.getByRole('tab', { name: /^Reviews/ })).toHaveAttribute('aria-selected', 'true')
    await expect(mp.getByRole('link', { name: /Awaiting manager review/ })).toHaveAttribute(
      'href',
      `/test-cases/${t.reviewCaseId}`,
    )
    await mp.getByRole('tab', { name: /^Run cases/ }).click()
    await expect(mp.getByText('No run cases waiting on you')).toBeVisible()
    await mp.getByRole('tab', { name: /^Defects/ }).click()
    await expect(mp.getByText('No open defects of yours')).toBeVisible()
  } finally {
    await tester.ctx.close()
    await manager.ctx.close()
  }
})

test('My Work: the admin sees the defect they reported; loading and error states; dark theme', async ({ browser }) => {
  const { ctx, page } = await newPage(browser, { width: 1280, height: 800 }, 'dark')
  try {
    // A slow response shows the loading state; a failing one shows the error with a retry.
    await page.route('**/my-work/run-cases', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1200))
      await route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":{"message":"boom"}}' })
    })
    await signIn(page, 'admin')
    await page.goto('/my-work')
    await expect(page.getByRole('status').filter({ hasText: 'Loading your run cases' })).toBeVisible()
    // The query retries a few times with backoff before it gives up.
    await expect(page.getByText('Your run cases could not be loaded.')).toBeVisible({ timeout: 45_000 })
    await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible()
    await page.unroute('**/my-work/run-cases')
    await page.getByRole('button', { name: 'Try again' }).click()
    await expect(page.getByText('No run cases waiting on you')).toBeVisible()

    await page.getByRole('tab', { name: /^Defects/ }).click()
    await expect(page.getByRole('link', { name: /Seeded defect/ })).toContainText('Reported by me')
    await shot(page, 'mywork-1280-dark')
    expect(formatFindings('my-work dark', await axeFindings(page))).toEqual([])
    await shot(page, 'sidebar-1280-dark')
  } finally {
    await ctx.close()
  }
})

for (const width of [1440, 1280, 1024, 768]) {
  test(`top bar at ${width}: one calm row, search opens the palette, account menu, no overflow`, async ({ browser }) => {
    const { ctx, page } = await newPage(browser, { width, height: 800 })
    try {
      await signIn(page, 'admin')
      await page.goto(`/projects/${t.projectId}/test-cases`)
      const bar = page.getByTestId('top-bar')
      const box = (await bar.boundingBox())!
      expect(box.height).toBeGreaterThanOrEqual(48)
      expect(box.height).toBeLessThanOrEqual(57)
      expect(await overflowOf(page)).toBeLessThanOrEqual(0)

      // Controls share one height (32-36px) and every target is at least 24px.
      const controls = [
        bar.getByRole('button', { name: 'New', exact: true }),
        bar.getByRole('button', { name: /^Notifications/ }),
        bar.getByRole('button', { name: /account menu$/ }),
        bar.getByRole('button', { name: /sidebar$/ }),
      ]
      for (const c of controls) {
        const b = (await c.boundingBox())!
        expect(b.height, await c.getAttribute('aria-label')).toBeGreaterThanOrEqual(32)
        expect(b.height, await c.getAttribute('aria-label')).toBeLessThanOrEqual(36.5)
        expect(b.width).toBeGreaterThanOrEqual(24)
      }
      // The only filled control is "+ New"; the removed duplicates are gone.
      await expect(bar.getByRole('button', { name: 'Appearance' })).toHaveCount(0)
      await expect(bar.getByRole('button', { name: 'Ask AI' })).toHaveCount(0)
      await expect(bar.getByText('Jump to')).toHaveCount(0)
      await expect(bar.getByRole('button', { name: 'New', exact: true })).toBeVisible()

      // Breadcrumb: parents are links, the current page is aria-current.
      const crumbs = page.getByRole('navigation', { name: 'Breadcrumb' })
      await expect(crumbs.getByRole('link', { name: 'Apex Motor Claims' })).toBeVisible()
      await expect(crumbs.locator('[aria-current="page"]')).toHaveText('Test Cases')

      // Search: a wide field from lg, an icon below; both open the same palette.
      const searchField = page.getByRole('search').getByRole('button')
      if (width >= 1024) {
        await expect(searchField).toBeVisible()
        await expect(searchField).toContainText(/Ctrl K|⌘ K/)
        await searchField.click()
      } else {
        await expect(page.getByRole('search')).toBeHidden()
        await bar.getByRole('button', { name: 'Search' }).click()
      }
      const palette = page.getByRole('dialog', { name: 'Command palette' })
      await expect(palette).toBeVisible()
      await expect(page.getByLabel('Command palette search')).toBeFocused()
      await page.getByLabel('Command palette search').fill('Apex')
      await expect(palette.getByRole('button', { name: /Apex Motor Claims\s*Project/ })).toBeVisible()
      await page.getByLabel('Command palette search').fill('Sprint')
      await expect(palette.getByRole('button', { name: /Sprint run\s*Test run/ })).toBeVisible()
      await page.getByLabel('Command palette search').fill('Verify settle')
      await expect(palette.getByRole('button', { name: /Verify settlement\s*Test Case/ })).toBeVisible()
      await page.keyboard.press('Escape')
      await expect(palette).toBeHidden()
      await page.keyboard.press('Control+k')
      await expect(palette).toBeVisible()
      await page.keyboard.press('Escape')

      // Account menu: profile, appearance, Ask AI and sign out live here.
      const account = bar.getByRole('button', { name: /account menu$/ })
      await account.click()
      await expect(page.getByRole('link', { name: 'My Account' })).toBeVisible()
      await expect(page.getByRole('button', { name: 'Appearance' })).toBeVisible()
      await expect(page.getByRole('button', { name: 'Ask AI' })).toBeVisible()
      await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible()
      if (width === 1280) await shot(page, 'topbar-menu-1280-light')
      await page.keyboard.press('ArrowDown')
      await page.keyboard.press('Escape')
      await expect(page.getByRole('link', { name: 'My Account' })).toBeHidden()
      await expect(account).toBeFocused()

      await page.goto('/')
      await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible()
      await shot(page, `topbar-${width}-light`)
      expect(formatFindings(`top bar ${width}`, await axeFindings(page))).toEqual([])
    } finally {
      await ctx.close()
    }
  })
}

test('top bar: Appearance from the account menu still switches themes; light and dark axe', async ({ browser }) => {
  const { ctx, page } = await newPage(browser, { width: 1280, height: 800 })
  try {
    await signIn(page, 'admin')
    const before = await page.evaluate(() => document.documentElement.dataset.theme)
    await page.getByRole('button', { name: /account menu$/ }).click()
    await page.getByRole('button', { name: 'Appearance' }).click()
    const dialog = page.getByRole('dialog', { name: 'Appearance' })
    await expect(dialog).toBeVisible()
    await dialog.getByRole('radio', { name: before === 'dark' ? /^light/i : /^dark/i }).click()
    await expect.poll(() => page.evaluate(() => document.documentElement.dataset.theme)).not.toBe(before)
    await shot(page, 'topbar-1280-dark')
    // Colours transition on a theme switch: measure contrast only once they have settled.
    await settle(page)
    await page.waitForTimeout(300)
    expect(formatFindings('top bar after switch', await axeFindings(page, {}, '[role="dialog"]'))).toEqual([])
    await dialog.getByRole('button', { name: 'Done' }).click()
    await expect(dialog).toBeHidden()
    await expect(page.getByRole('button', { name: /account menu$/ })).toBeVisible()
    expect(formatFindings('top bar dark', await axeFindings(page))).toEqual([])

    // Ask AI opens from the same menu.
    await page.getByRole('button', { name: /account menu$/ }).click()
    await page.getByRole('button', { name: 'Ask AI' }).click()
    await expect(page.getByRole('dialog', { name: 'AI Assistant' })).toBeVisible()
    await page.keyboard.press('Escape')
  } finally {
    await ctx.close()
  }
})

for (const theme of ['light', 'dark'] as const) {
  test(`phone 375 (${theme}): current-page breadcrumb, 44px controls, More sheet with My Work and favourites, no overflow`, async ({
    browser,
  }) => {
    const { ctx, page } = await newPage(browser, { width: 375, height: 812 }, theme)
    try {
      await signIn(page, 'tester')
      // Star the project so the sheet has a Favourites section.
      await page.goto(`/projects/${t.projectId}`)
      const star = page.getByRole('button', { name: 'Add to favourites' })
      expect((await star.boundingBox())!.height).toBeGreaterThanOrEqual(44)
      await star.click()
      await page.goto(`/projects/${t.projectId}/test-cases`)
      const bar = page.getByTestId('top-bar')
      const crumbs = page.getByRole('navigation', { name: 'Breadcrumb' })
      await expect(crumbs.locator('[aria-current="page"]')).toHaveText('Test Cases')
      await expect(crumbs.getByRole('link', { name: 'Projects' })).toBeHidden()
      for (const c of [
        bar.getByRole('button', { name: 'New', exact: true }),
        bar.getByRole('button', { name: 'Search' }),
        bar.getByRole('button', { name: /^Notifications/ }),
      ]) {
        const b = (await c.boundingBox())!
        expect(b.height).toBeGreaterThanOrEqual(44)
        expect(b.width).toBeGreaterThanOrEqual(44)
      }
      await expect(bar.getByRole('button', { name: /sidebar$/ })).toBeHidden()
      expect(await overflowOf(page)).toBeLessThanOrEqual(0)
      await shot(page, `topbar-375-${theme}`)
      expect(formatFindings(`phone top bar ${theme}`, await axeFindings(page))).toEqual([])

      await page.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name: 'More' }).click()
      const sheet = page.getByRole('dialog', { name: 'More' })
      await expect(sheet.getByRole('link', { name: /^My Work\s*, 1 pending$/ })).toBeVisible()
      await expect(sheet.getByRole('link', { name: 'Execution Console' })).toBeVisible()
      await expect(sheet.getByText('Favourites', { exact: true })).toBeVisible()
      await expect(sheet.getByRole('link', { name: 'Apex Motor Claims' }).first()).toBeVisible()
      await shot(page, `mobile-more-375-${theme}`)
      expect(formatFindings(`phone sheet ${theme}`, await axeFindings(page, {}, '[role="dialog"]'))).toEqual([])
      await sheet.getByRole('link', { name: /^My Work/ }).click()
      await expect(page).toHaveURL(/\/my-work$/)
      await expect(page.getByRole('heading', { level: 1, name: 'My Work' })).toBeVisible()
      expect(await overflowOf(page)).toBeLessThanOrEqual(0)
      await shot(page, `mywork-375-${theme}`)
      expect(formatFindings(`phone my work ${theme}`, await axeFindings(page))).toEqual([])
    } finally {
      await ctx.close()
    }
  })
}

test('tablet 768: sidebar and My Work fit without overflow, light and dark', async ({ browser }) => {
  for (const theme of ['light', 'dark'] as const) {
    const { ctx, page } = await newPage(browser, { width: 768, height: 900 }, theme)
    try {
      await signIn(page, 'tester')
      for (const path of ['/', '/my-work', '/projects']) {
        await page.goto(path)
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
        expect(await overflowOf(page), `${path} ${theme}`).toBeLessThanOrEqual(0)
      }
      await page.goto('/my-work')
      await expect(page.getByRole('heading', { level: 1, name: 'My Work' })).toBeVisible()
      await expect(page.getByText('Failed - retest')).toBeVisible()
      await shot(page, `mywork-768-${theme}`)
      expect(formatFindings(`tablet ${theme}`, await axeFindings(page))).toEqual([])
    } finally {
      await ctx.close()
    }
  }
})
