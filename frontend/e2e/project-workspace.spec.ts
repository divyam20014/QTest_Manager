import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test'

import { axeFindings, formatFindings } from './a11y'
import { API_BASE_URL, loginViaUi } from './fixtures'
import { seedRoleTenant, type RoleTenant } from './roleTenant'

// ADR-122 (phase 3): the project workspace: header, tab strip with More menu, project switcher,
// Settings > Project navigation (order and visibility), hidden-tab behaviour, role views, phones,
// and light / dark axe. One throwaway tenant with projects Apex (the seeded one), Beta and Aardvark.
test.setTimeout(480_000)
test.describe.configure({ mode: 'serial' })

const SHOTS = process.env.PROJ_SHOTS_DIR

let t: RoleTenant
let betaId = ''
let aardvarkId = ''

const overflowOf = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
const tabs = (page: Page) => page.getByRole('navigation', { name: 'Project sections' })

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

async function api(page: Page, method: 'get' | 'post' | 'patch', path: string, data?: unknown) {
  return page.request[method](`${API_BASE_URL}${path}`, data === undefined ? undefined : { data })
}

async function newProject(request: Page['request'], name: string): Promise<string> {
  const res = await request.post(`${API_BASE_URL}/projects`, {
    data: {
      name,
      domain: 'Motor',
      priority: 'Medium',
      manager_name: 'Jane Manager',
      start_date: '2026-01-01',
      end_date: '2026-12-31',
      budget: '1000.00',
      region: 'North America',
    },
  })
  expect(res.ok(), await res.text()).toBeTruthy()
  return (await res.json()).data.id
}

test.beforeAll(async ({ playwright }) => {
  const request = await playwright.request.newContext()
  t = await seedRoleTenant(request, 'ProjWs', { withData: true })
  const login = await request.post(`${API_BASE_URL}/auth/login`, {
    data: { tenant_id: t.tenantId, email: t.adminEmail, password: t.adminPassword },
  })
  const verify = await request.post(`${API_BASE_URL}/auth/mfa/verify`, {
    data: { code: (await login.json()).data.debug_code },
  })
  expect(verify.ok()).toBeTruthy()
  betaId = await newProject(request, 'Beta Workspace')
  aardvarkId = await newProject(request, 'Aardvark Alpha')
  await request.post(`${API_BASE_URL}/auth/logout`)
  await request.dispose()
})

test('header and tab strip: name, status, owner, progress, favourite, real tabs, aria-current', async ({ browser }) => {
  const { ctx, page } = await newPage(browser, { width: 1280, height: 800 })
  try {
    await signIn(page, 'admin')
    await page.goto(`/projects/${t.projectId}`)
    await expect(page.getByRole('heading', { level: 1, name: 'Apex Motor Claims' })).toBeVisible()
    const header = page.getByTestId('project-header')
    await expect(header.getByText('On Track')).toBeVisible()
    await expect(page.getByTestId('project-owner')).toContainText('Jane Manager')
    // ADR-123: progress is the executed share from the project-test-status aggregate (the seeded
    // project has one case, executed once with a failed step: 100% executed, 0% pass rate).
    const bar = header.getByRole('progressbar', { name: 'Test execution progress' })
    await expect(bar).toHaveAttribute('aria-valuenow', '100')
    await expect(page.getByTestId('project-progress')).toContainText('100% executed (1/1) · 0% case pass rate')

    const star = header.getByRole('button', { name: 'Add to favourites' })
    await star.click()
    await expect(header.getByRole('button', { name: 'Remove from favourites' })).toHaveAttribute('aria-pressed', 'true')
    await header.getByRole('button', { name: 'Remove from favourites' }).click()

    // Core tabs, in the default order; only Overview is current; counts do not change a name.
    const names = await tabs(page).getByRole('link').allInnerTexts()
    const labels = names.map((n) => n.replace(/\s*\d+$/, '').trim())
    // Tasks (ADR-127) is an optional tab that sits right after Overview.
    // ADR-128: no Requirements tab; requirements are created and managed in tasks.
    expect(labels.slice(0, 6)).toEqual(['Overview', 'Tasks', 'Test Cases', 'Test Runs', 'Defects', 'Reports'])
    expect(labels).not.toContain('Requirements')
    await expect(tabs(page).locator('[aria-current="page"]')).toHaveCount(1)
    await expect(tabs(page).getByRole('link', { name: 'Overview', exact: true })).toHaveAttribute('aria-current', 'page')
    // No tab without a real page.
    for (const gone of ['Documents', 'Automation', 'Calendar']) {
      await expect(tabs(page).getByText(gone)).toHaveCount(0)
    }

    await tabs(page).getByRole('link', { name: 'Test Cases', exact: true }).click()
    await expect(page).toHaveURL(new RegExp(`/projects/${t.projectId}/test-cases$`))
    await expect(tabs(page).getByRole('link', { name: 'Test Cases', exact: true })).toHaveAttribute('aria-current', 'page')
    await expect(page.getByRole('navigation', { name: 'Breadcrumb' })).toContainText('Apex Motor Claims')
    // The page keeps its own single h1; the project name is not a second heading.
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)

    // Defects and Reports live at /defects and /reporting but keep the project header and tabs.
    await tabs(page).getByRole('link', { name: 'Defects', exact: true }).click()
    await expect(page).toHaveURL(new RegExp(`/defects[?]projectId=${t.projectId}`))
    await expect(page.getByTestId('project-header')).toBeVisible()
    await expect(tabs(page).getByRole('link', { name: 'Defects', exact: true })).toHaveAttribute('aria-current', 'page')
    await expect(page.getByRole('navigation', { name: 'Breadcrumb' })).toContainText('Defects')
    await tabs(page).getByRole('link', { name: 'Reports', exact: true }).click()
    await expect(page).toHaveURL(new RegExp(`/reporting[?]project=${t.projectId}`))
    await expect(tabs(page).getByRole('link', { name: 'Reports', exact: true })).toHaveAttribute('aria-current', 'page')
    // Unscoped, /defects is the plain list again.
    await page.goto('/defects')
    await expect(page.getByTestId('project-header')).toHaveCount(0)

    // The settings shortcut opens the Settings tab.
    await page.goto(`/projects/${t.projectId}`)
    await page.getByTestId('project-settings-shortcut').click()
    await expect(page).toHaveURL(new RegExp(`/projects/${t.projectId}/settings$`))
    await expect(page.getByRole('heading', { level: 1, name: 'Project settings' })).toBeVisible()
  } finally {
    await ctx.close()
  }
})

test('every moved tab has a real page and the old /details URL redirects to the Overview', async ({ browser }) => {
  const { ctx, page } = await newPage(browser, { width: 1440, height: 900 })
  try {
    await signIn(page, 'admin')
    const expectations: [string, string][] = [
      ['test-plans', 'Planning'],
      ['releases', 'Releases'],
      ['team', 'Team'],
      ['activity', 'Activity'],
      ['settings', 'Project settings'],
    ]
    for (const [path, heading] of expectations) {
      await page.goto(`/projects/${t.projectId}/${path}`)
      await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible()
    }
    await page.goto(`/projects/${t.projectId}/team`)
    await expect(page.getByRole('heading', { name: 'Team Members' })).toBeVisible()
    await page.goto(`/projects/${t.projectId}/test-plans`)
    await expect(page.getByRole('textbox', { name: 'New suite name' })).toBeVisible()
    await expect(page.getByRole('textbox', { name: 'New plan name' })).toBeVisible()
    await page.goto(`/projects/${t.projectId}/details`)
    await expect(page).toHaveURL(new RegExp(`/projects/${t.projectId}$`))
    await expect(page.getByTestId('project-header')).toBeVisible()
    // An unknown sub-route is a normal not-found page.
    await page.goto(`/projects/${t.projectId}/nonsense`)
    await expect(page.getByText(/not found/i).first()).toBeVisible()
  } finally {
    await ctx.close()
  }
})

test('project switcher: search, recent first, keeps the current tab, falls back to Overview, keyboard', async ({ browser }) => {
  const { ctx, page } = await newPage(browser, { width: 1280, height: 800 })
  try {
    await signIn(page, 'admin')
    // Visit order: Beta, then Apex. Alphabetically Aardvark would be first; recents must win.
    await page.goto(`/projects/${betaId}`)
    await expect(page.getByRole('heading', { level: 1, name: 'Beta Workspace' })).toBeVisible()
    await page.goto(`/projects/${t.projectId}/test-cases`)
    await expect(page.getByTestId('project-header')).toContainText('Apex Motor Claims')

    const trigger = page.getByTestId('project-switcher')
    await trigger.click()
    const search = page.getByRole('combobox', { name: 'Search projects' })
    await expect(search).toBeFocused()
    const options = page.getByRole('listbox', { name: 'Projects' }).getByRole('option')
    await expect(options).toHaveCount(3)
    await expect(options.nth(0)).toContainText('Apex Motor Claims')
    await expect(options.nth(0)).toContainText('Current')
    await expect(options.nth(1)).toContainText('Beta Workspace')
    await expect(options.nth(1)).toContainText('Recent')
    await expect(options.nth(2)).toContainText('Aardvark Alpha')

    // Search narrows the list; Escape closes and returns focus to the trigger.
    await search.fill('aard')
    await expect(options).toHaveCount(1)
    await search.fill('no such project')
    await expect(page.getByText('No project matches.')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('combobox', { name: 'Search projects' })).toHaveCount(0)
    await expect(trigger).toBeFocused()

    // Keyboard: ArrowDown + Enter picks the second option; the Test Cases tab is kept.
    await page.keyboard.press('Enter')
    await expect(search).toBeFocused()
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(new RegExp(`/projects/${betaId}/test-cases$`))
    await expect(page.getByTestId('project-header')).toContainText('Beta Workspace')

    // Mouse: choose Aardvark from the Defects tab; the project-scoped URL is kept too.
    await tabs(page).getByRole('link', { name: 'Defects', exact: true }).click()
    await expect(page).toHaveURL(new RegExp(`/defects[?]projectId=${betaId}`))
    // The lazy Defects page may still be loading; wait until the tab strip reflects it.
    await expect(tabs(page).getByRole('link', { name: 'Defects', exact: true })).toHaveAttribute('aria-current', 'page')
    await page.getByTestId('project-switcher').click()
    await page.getByRole('option', { name: /Aardvark Alpha/ }).click()
    await expect(page).toHaveURL(new RegExp(`/defects[?]projectId=${aardvarkId}`))

    // The target hides Team: switching from Team lands on its Overview instead of a hidden tab.
    const patch = await api(page, 'patch', `/projects/${betaId}`, { nav_config: { order: [], hidden: ['team'] } })
    expect(patch.ok(), await patch.text()).toBeTruthy()
    await page.goto(`/projects/${t.projectId}/team`)
    await page.getByTestId('project-switcher').click()
    await page.getByRole('option', { name: /Beta Workspace/ }).click()
    await expect(page).toHaveURL(new RegExp(`/projects/${betaId}$`))
    await expect(page.getByRole('heading', { level: 1, name: 'Beta Workspace' })).toBeVisible()
    await api(page, 'patch', `/projects/${betaId}`, { nav_config: null })
  } finally {
    await ctx.close()
  }
})

test('settings: reorder with buttons and keyboard, hide optional tabs, save, reload, direct link, reset', async ({ browser }) => {
  const { ctx, page } = await newPage(browser, { width: 1440, height: 900 })
  try {
    await signIn(page, 'admin')
    await page.goto(`/projects/${betaId}/settings`)
    await expect(page.getByRole('heading', { level: 2, name: 'Project navigation' })).toBeVisible()
    const rows = page.getByRole('list', { name: 'Project tab order' }).getByRole('listitem')
    await expect(rows).toHaveCount(11)
    // Core tabs and Settings cannot be hidden: no checkbox for them.
    for (const fixed of ['Overview', 'Test Cases', 'Test Runs', 'Defects', 'Reports', 'Settings']) {
      await expect(page.getByRole('checkbox', { name: `Show ${fixed} tab` })).toHaveCount(0)
    }
    await expect(page.getByRole('button', { name: 'Move Overview up' })).toBeDisabled()
    await expect(page.getByRole('button', { name: 'Move Settings down' })).toBeDisabled()
    await expect(page.getByRole('button', { name: 'Save tabs' })).toBeDisabled()
    await expect(page.getByRole('button', { name: 'Reset to defaults' })).toBeDisabled()

    // Mouse: Defects up one place. Keyboard: Reports up with Enter, focus stays on the pressed button.
    await page.getByRole('button', { name: 'Move Defects up' }).click()
    await expect(page.getByRole('button', { name: 'Move Defects up' })).toBeFocused()
    await page.getByRole('button', { name: 'Move Reports up' }).focus()
    await page.keyboard.press('Enter')
    await expect(page.getByRole('button', { name: 'Move Reports up' })).toBeFocused()
    await page.getByRole('checkbox', { name: 'Show Releases tab' }).uncheck()
    await page.getByRole('checkbox', { name: 'Show Activity tab' }).uncheck()
    await expect(page.getByRole('button', { name: 'Save tabs' })).toBeEnabled()
    await page.getByRole('button', { name: 'Save tabs' }).click()
    await expect(page.getByText('Project tabs saved')).toBeVisible()

    // Persisted: the saved config comes back from the API and the strip follows it after a reload.
    const saved = (await (await api(page, 'get', `/projects/${betaId}`)).json()).data.nav_config
    expect(saved.hidden.sort()).toEqual(['activity', 'releases'])
    expect(saved.order.slice(0, 6)).toEqual(['overview', 'tasks', 'test-cases', 'defects', 'reports', 'test-runs'])
    await page.reload()
    await expect(page.getByRole('heading', { level: 2, name: 'Project navigation' })).toBeVisible()
    await expect(tabs(page).getByRole('link', { name: 'Releases', exact: true })).toHaveCount(0)
    await expect(tabs(page).getByRole('link', { name: 'Activity', exact: true })).toHaveCount(0)
    await expect(tabs(page).getByRole('link', { name: 'Planning', exact: true })).toBeVisible()
    const labels = (await tabs(page).getByRole('link').allInnerTexts()).map((n) => n.replace(/\s*\d+$/, '').trim())
    expect(labels.slice(0, 6)).toEqual(['Overview', 'Tasks', 'Test Cases', 'Defects', 'Reports', 'Test Runs'])
    await expect(page.getByRole('checkbox', { name: 'Show Releases tab' })).not.toBeChecked()

    // Hidden is not blocked: the direct link opens with a notice that offers the way back.
    await page.goto(`/projects/${betaId}/releases`)
    await expect(page.getByRole('heading', { level: 1, name: 'Releases' })).toBeVisible()
    const notice = page.getByTestId('hidden-tab-notice')
    await expect(notice).toContainText('Releases tab is hidden')
    await expect(notice.getByRole('link', { name: 'Show it in project settings' })).toBeVisible()
    await expect(tabs(page).getByRole('link', { name: 'Releases', exact: true })).toHaveCount(0)

    // Releases are editable (PATCH /releases/{id}).
    const created = await api(page, 'post', `/projects/${betaId}/releases`, { name: 'R 1.0' })
    expect(created.ok()).toBeTruthy()
    await page.reload()
    await page.getByRole('button', { name: 'Edit release R 1.0' }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByLabel('Name').fill('R 1.1')
    await dialog.getByLabel('Target date').fill('2026-09-30')
    await dialog.getByRole('combobox', { name: 'Status' }).click()
    await page.getByRole('option', { name: 'In Progress' }).click()
    await dialog.getByRole('button', { name: 'Save release' }).click()
    await expect(page.getByText('Release updated')).toBeVisible()
    await expect(page.getByText('R 1.1')).toBeVisible()
    await expect(page.getByText('In Progress · 2026-09-30')).toBeVisible()

    // The server refuses hiding a core tab or an unknown key.
    for (const hidden of [['overview'], ['settings'], ['calendar']]) {
      const bad = await api(page, 'patch', `/projects/${betaId}`, { nav_config: { order: [], hidden } })
      expect(bad.status()).toBe(422)
    }

    // Reset to defaults (with confirmation) brings every tab back and stores null.
    await page.goto(`/projects/${betaId}/settings`)
    await page.getByRole('button', { name: 'Reset to defaults' }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Reset to defaults' }).click()
    await expect(page.getByText('Project tabs reset to the defaults')).toBeVisible()
    await expect(tabs(page).getByRole('link', { name: 'Releases', exact: true })).toBeVisible()
    expect((await (await api(page, 'get', `/projects/${betaId}`)).json()).data.nav_config).toBeNull()
  } finally {
    await ctx.close()
  }
})

test('roles: tester has no Settings, manager edits assigned projects only, hidden tab note differs', async ({ browser }) => {
  // Hide Team on Apex so the hidden-tab note can be checked for each role.
  const { ctx: actx, page: admin } = await newPage(browser, { width: 1280, height: 800 })
  try {
    await signIn(admin, 'admin')
    const res = await api(admin, 'patch', `/projects/${t.projectId}`, { nav_config: { order: [], hidden: ['team'] } })
    expect(res.ok(), await res.text()).toBeTruthy()
    await admin.goto(`/projects/${t.projectId}`)
    await expect(tabs(admin).getByRole('link', { name: 'Settings', exact: true })).toBeVisible()
    await expect(tabs(admin).getByRole('link', { name: 'Team', exact: true })).toHaveCount(0)
  } finally {
    await actx.close()
  }

  const { ctx: tctx, page: tester } = await newPage(browser, { width: 1280, height: 800 })
  try {
    await signIn(tester, 'tester')
    await tester.goto(`/projects/${t.projectId}`)
    await expect(tester.getByRole('heading', { level: 1, name: 'Apex Motor Claims' })).toBeVisible()
    await expect(tabs(tester).getByRole('link', { name: 'Settings', exact: true })).toHaveCount(0)
    await expect(tester.getByTestId('project-settings-shortcut')).toHaveCount(0)
    await expect(tabs(tester).getByRole('link', { name: 'Team', exact: true })).toHaveCount(0)
    // Direct links still work for the tester; the note has no way to settings.
    await tester.goto(`/projects/${t.projectId}/team`)
    await expect(tester.getByRole('heading', { level: 1, name: 'Team' })).toBeVisible()
    const note = tester.getByTestId('hidden-tab-notice')
    await expect(note).toContainText('Team tab is hidden')
    await expect(note.getByRole('link')).toHaveCount(0)
    // The Settings page itself refuses, and the API does too.
    await tester.goto(`/projects/${t.projectId}/settings`)
    await expect(tester.getByText(/don.t have access/i).first()).toBeVisible()
    const denied = await api(tester, 'patch', `/projects/${t.projectId}`, { nav_config: null })
    expect(denied.status()).toBe(403)
    // A project the tester is not on does not open at all.
    await tester.goto(`/projects/${betaId}`)
    await expect(tester.getByText(/could not load this project|not found|no access/i).first()).toBeVisible({ timeout: 20_000 })
  } finally {
    await tctx.close()
  }

  const { ctx: mctx, page: manager } = await newPage(browser, { width: 1280, height: 800 })
  try {
    await signIn(manager, 'manager')
    await manager.goto(`/projects/${t.projectId}/settings`)
    await expect(manager.getByRole('heading', { level: 2, name: 'Project navigation' })).toBeVisible()
    await expect(tabs(manager).getByRole('link', { name: 'Settings', exact: true })).toHaveAttribute('aria-current', 'page')
    // Assigned project: allowed. Unassigned project: the API refuses (ADR-018), the UI shows the error.
    await manager.getByRole('button', { name: 'Reset to defaults' }).click()
    await manager.getByRole('dialog').getByRole('button', { name: 'Reset to defaults' }).click()
    await expect(manager.getByText('Project tabs reset to the defaults')).toBeVisible()
    const other = await api(manager, 'patch', `/projects/${betaId}`, { nav_config: { order: [], hidden: ['team'] } })
    expect(other.status()).toBe(403)
  } finally {
    await mctx.close()
  }
})

test('phone: the project nav fits 375 and 768 without sideways scroll, More menu, 44px targets', async ({ browser }) => {
  const { ctx, page } = await newPage(browser, { width: 375, height: 812 })
  try {
    await signIn(page, 'admin')
    await page.goto(`/projects/${t.projectId}`)
    await expect(page.getByRole('heading', { level: 1, name: 'Apex Motor Claims' })).toBeVisible()
    expect(await overflowOf(page)).toBeLessThanOrEqual(0)
    await shot(page, 'phone-375-overview')

    const more = page.getByTestId('project-tabs-more')
    await expect(more).toBeVisible()
    for (const target of [tabs(page).getByRole('link').first(), more, page.getByTestId('project-switcher')]) {
      expect((await target.boundingBox())!.height).toBeGreaterThanOrEqual(44)
    }
    await more.click()
    const menu = page.getByRole('menu', { name: 'More project sections' })
    await expect(menu).toBeVisible()
    expect(await overflowOf(page)).toBeLessThanOrEqual(0)
    await shot(page, 'phone-375-more')
    const items = menu.getByRole('menuitem')
    expect(await items.count()).toBeGreaterThan(0)
    // Choosing an item opens that tab, which then stays in the strip as the current one.
    await menu.getByRole('menuitem', { name: 'Settings' }).click()
    await expect(page).toHaveURL(new RegExp(`/projects/${t.projectId}/settings$`))
    await expect(tabs(page).getByRole('link', { name: 'Settings', exact: true })).toHaveAttribute('aria-current', 'page')
    expect(await overflowOf(page)).toBeLessThanOrEqual(0)

    // Switcher panel fits the screen.
    await page.getByTestId('project-switcher').click()
    const panel = page.getByRole('listbox', { name: 'Projects' })
    await expect(panel).toBeVisible()
    const box = (await panel.boundingBox())!
    expect(box.x).toBeGreaterThanOrEqual(0)
    expect(box.x + box.width).toBeLessThanOrEqual(375)
    await shot(page, 'phone-375-switcher')
    await page.keyboard.press('Escape')

    // Settings rows keep 44px reorder buttons and no sideways scroll on a phone.
    for (const name of ['Move Defects up', 'Move Defects down']) {
      expect((await page.getByRole('button', { name }).boundingBox())!.height).toBeGreaterThanOrEqual(44)
    }
    expect(await overflowOf(page)).toBeLessThanOrEqual(0)

    await page.setViewportSize({ width: 768, height: 1024 })
    await page.goto(`/projects/${t.projectId}`)
    await expect(page.getByRole('heading', { level: 1, name: 'Apex Motor Claims' })).toBeVisible()
    expect(await overflowOf(page)).toBeLessThanOrEqual(0)
    await shot(page, 'tablet-768-overview')
  } finally {
    await ctx.close()
  }
})

for (const theme of ['light', 'dark'] as const) {
  test(`axe: project header, tabs, switcher, settings and moved tabs (${theme})`, async ({ browser }) => {
    const { ctx, page } = await newPage(browser, { width: 1280, height: 800 }, theme)
    try {
      await signIn(page, 'admin')
      const pid = t.projectId
      for (const [name, path] of [
        ['overview', `/projects/${pid}`],
        ['test-cases', `/projects/${pid}/test-cases`],
        ['planning', `/projects/${pid}/test-plans`],
        ['releases', `/projects/${pid}/releases`],
        ['team', `/projects/${pid}/team`],
        ['activity', `/projects/${pid}/activity`],
        ['settings', `/projects/${pid}/settings`],
      ] as const) {
        await page.goto(path)
        await expect(page.getByTestId('project-header')).toBeVisible()
        await page.waitForLoadState('networkidle')
        expect(formatFindings(`project ${name} ${theme}`, await axeFindings(page))).toEqual([])
      }
      await page.goto(`/projects/${pid}`)
      await page.getByTestId('project-switcher').click()
      await expect(page.getByRole('option').first()).toBeVisible()
      expect(formatFindings(`project switcher ${theme}`, await axeFindings(page))).toEqual([])
      await page.keyboard.press('Escape')
      // Phone More menu open.
      await page.setViewportSize({ width: 375, height: 812 })
      await page.goto(`/projects/${pid}`)
      await page.getByTestId('project-tabs-more').click()
      await expect(page.getByRole('menu', { name: 'More project sections' })).toBeVisible()
      expect(formatFindings(`project more menu ${theme}`, await axeFindings(page))).toEqual([])
    } finally {
      await ctx.close()
    }
  })
}

test('screenshots (only with PROJ_SHOTS_DIR): header, switcher, settings, phone nav at four widths, light and dark', async ({ browser }) => {
  test.skip(!SHOTS, 'set PROJ_SHOTS_DIR to capture screenshots')
  for (const theme of ['light', 'dark'] as const) {
    for (const width of [1440, 1280, 768, 375]) {
      const { ctx, page } = await newPage(browser, { width, height: width < 800 ? 900 : 800 }, theme)
      try {
        await signIn(page, 'admin')
        await page.goto(`/projects/${t.projectId}`)
        await expect(page.getByRole('heading', { level: 1, name: 'Apex Motor Claims' })).toBeVisible()
        await page.waitForLoadState('networkidle')
        await shot(page, `overview-${width}-${theme}`)
        await page.goto(`/projects/${t.projectId}/test-cases`)
        await expect(page.getByTestId('project-header')).toBeVisible()
        await page.waitForLoadState('networkidle')
        await shot(page, `test-cases-${width}-${theme}`)
        await page.getByTestId('project-switcher').click()
        await expect(page.getByRole('option').first()).toBeVisible()
        await shot(page, `switcher-${width}-${theme}`)
        await page.keyboard.press('Escape')
        await page.goto(`/projects/${t.projectId}/settings`)
        await expect(page.getByRole('heading', { level: 2, name: 'Project navigation' })).toBeVisible()
        await page.waitForLoadState('networkidle')
        await shot(page, `settings-${width}-${theme}`)
        if (width === 375) {
          await page.goto(`/projects/${t.projectId}`)
          await page.getByTestId('project-tabs-more').click()
          await shot(page, `more-menu-${width}-${theme}`)
        }
      } finally {
        await ctx.close()
      }
    }
  }
})
