import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test'

import { axeFindings, formatFindings } from './a11y'
import { API_BASE_URL, bootstrapTenant, loginViaUi, seedDefectBody, type SeededTenant } from './fixtures'

// ADR-124: List / Board / Calendar views over real data. One throwaway tenant, project "Views Co" with
// approved cases (some executed), two runs with due dates, a release and defects; a Manager and a Tester.
// Boards: counts equal the API, a drag and the Move to menu go through the real status endpoints, a
// refused move shows the server message and leaves the card, test cases are read-only. Calendar: real
// due dates and releases, entries open their records, the phone shows an agenda. Axe in light and dark.
// Set VIEWS_SHOTS_DIR to also write screenshots.

const SHOTS = process.env.VIEWS_SHOTS_DIR
const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10)

interface Ctx extends SeededTenant {
  managerEmail: string
  managerPassword: string
  testerEmail: string
  testerPassword: string
  projectId: string
  runName: string
  lateRunName: string
  runId: string
  releaseName: string
  defectTitles: string[]
}
let t: Ctx

test.describe.configure({ mode: 'serial' })

async function shot(page: Page, name: string, fullPage = true) {
  // A full-page capture resizes the window, which closes an open menu: pass false for those.
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage })
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
    manager: [t.managerEmail, t.managerPassword],
    tester: [t.testerEmail, t.testerPassword],
  }[who]
  await loginViaUi(page, t.tenantId, creds[0], creds[1])
}

async function getJson(page: Page, path: string) {
  const res = await page.request.get(`${API_BASE_URL}${path}`)
  expect(res.ok(), `${path}: ${await res.text()}`).toBeTruthy()
  return (await res.json()).data
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

async function axeBothThemes(page: Page, label: string, problems: string[]) {
  for (const theme of ['light', 'dark'] as const) {
    await page.evaluate((v) => {
      document.documentElement.dataset.theme = v
    }, theme)
    await settle(page)
    await page.waitForTimeout(250)
    problems.push(...formatFindings(`${label} ${theme}`, await axeFindings(page)))
  }
}

const overflowOf = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)

const viewSwitch = (page: Page, mode: 'List' | 'Board' | 'Calendar') =>
  page.getByRole('group', { name: 'View', exact: true }).getByRole('button', { name: mode })
const column = (page: Page, id: string) => page.locator(`[data-column="${id}"]`)
const countOf = (page: Page, id: string) =>
  column(page, id)
    .getByLabel(/^\d+ in /)
    .innerText()
    .then((s) => Number(s))

test.beforeAll(async ({ request }) => {
  test.setTimeout(300_000)
  const tenant = await bootstrapTenant(request, 'Views')
  const suffix = tenant.tenantId.slice(0, 8)
  const login = await request.post(`${API_BASE_URL}/auth/login`, {
    data: { tenant_id: tenant.tenantId, email: tenant.adminEmail, password: tenant.adminPassword },
  })
  expect(login.ok(), await login.text()).toBeTruthy()
  const verify = await request.post(`${API_BASE_URL}/auth/mfa/verify`, {
    data: { code: (await login.json()).data.debug_code },
  })
  expect(verify.ok(), await verify.text()).toBeTruthy()
  const send = async (path: string, data?: unknown, method: 'post' | 'patch' = 'post') => {
    const res = await request[method](`${API_BASE_URL}${path}`, { data })
    expect(res.ok(), `${path}: ${await res.text()}`).toBeTruthy()
    return (await res.json()).data
  }
  const user = async (role: 'manager' | 'tester', password: string) => {
    const email = `${role}-${suffix}@example.com`
    const created = await send('/users', { email, name: `${role[0].toUpperCase()}${role.slice(1)} E2E`, role, password })
    return { email, password, id: created.id as string }
  }
  const manager = await user('manager', 'ManagerPassw0rd1!')
  const tester = await user('tester', 'TesterPassw0rd1!')
  const project = await send('/projects', {
    name: 'Views Co',
    domain: 'Motor',
    priority: 'High',
    manager_name: 'Jane Manager',
    start_date: '2026-01-01',
    end_date: '2026-12-31',
    budget: '1000.00',
    region: 'North America',
  })
  const projectId = project.id as string
  for (const m of [manager, tester]) await send(`/projects/${projectId}/members`, { user_id: m.id })
  const moduleId = (await send(`/projects/${projectId}/modules`, { name: 'Claims' })).id as string
  const mkCase = async (title: string) => {
    const tc = await send(`/projects/${projectId}/test-cases`, {
      title,
      priority: 'High',
      module_id: moduleId,
      preconditions: 'The claim exists',
      test_data: 'claim=C-100',
      expected_result: 'It works',
      steps: [
        { action: 'Open the claim', expected: 'Opens' },
        { action: 'Settle the claim', expected: 'Settled' },
      ],
    })
    await send(`/test-cases/${tc.id}/submit-review`, {})
    await send(`/test-cases/${tc.id}/approve`)
    return tc.id as string
  }
  const [c1, c2, c3, c4] = [await mkCase('Intake passes'), await mkCase('Intake fails'), await mkCase('Payout idle'), await mkCase('Payout late')]
  const runName = 'Views sweep'
  const run = await send(`/projects/${projectId}/test-runs`, {
    name: runName,
    run_type: 'Regression',
    test_case_ids: [c1, c2, c3],
    due_date: day(0),
  })
  const rcOf = (r: { cases: { id: string; test_case_id: string }[] }, id: string) => r.cases.find((c) => c.test_case_id === id)!.id
  const verdictAll = async (rc: string, verdict: 'pass' | 'fail') => {
    const steps = (await (await request.get(`${API_BASE_URL}/test-run-cases/${rc}/steps`)).json()).data
    for (const s of steps) {
      await send(`/execution-steps/${s.id}/verdict`, { verdict, ...(verdict === 'fail' ? { actual_result: 'It broke' } : {}) })
    }
  }
  await verdictAll(rcOf(run, c1), 'pass')
  await verdictAll(rcOf(run, c2), 'fail')
  const lateRunName = 'Late run'
  await send(`/projects/${projectId}/test-runs`, { name: lateRunName, run_type: 'Smoke', test_case_ids: [c4], due_date: day(-1) })
  const releaseName = 'Release V1'
  await send(`/projects/${projectId}/releases`, { name: releaseName, release_date: day(0), status: 'Planned' })
  const defectTitles = ['Settlement total is wrong', 'Typo on the intake form', 'Slow claim search']
  for (const title of defectTitles) await send('/defects', seedDefectBody(projectId, { title }))
  await request.post(`${API_BASE_URL}/auth/logout`)
  t = {
    ...tenant,
    managerEmail: manager.email,
    managerPassword: manager.password,
    testerEmail: tester.email,
    testerPassword: tester.password,
    projectId,
    runName,
    lateRunName,
    runId: run.id,
    releaseName,
    defectTitles,
  }
})

test('defects: the view is kept in the URL and remembered, columns show the server counts', async ({ page }) => {
  test.setTimeout(180_000)
  await signIn(page, 'admin')
  await page.goto(`/defects?projectId=${t.projectId}`)
  await expect(viewSwitch(page, 'List')).toHaveAttribute('aria-pressed', 'true')
  await viewSwitch(page, 'Board').click()
  await expect(page).toHaveURL(/view=board/)
  const board = page.getByRole('region', { name: 'Defects board' })
  await expect(board).toBeVisible()
  const counts = await getJson(page, `/defects/status-counts?project_id=${t.projectId}`)
  await expect(column(page, 'New').getByLabel(/^\d+ in New$/)).toHaveText(String(counts.counts.New ?? 0))
  expect(counts.counts.New).toBe(3)
  await expect(board.getByRole('link', { name: t.defectTitles[0] })).toBeVisible()
  // Remembered per user and list: a visit with no ?view= comes back as a board.
  await page.goto(`/defects?projectId=${t.projectId}`)
  await expect(viewSwitch(page, 'Board')).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('region', { name: 'Defects board' })).toBeVisible()
  await viewSwitch(page, 'List').click()
  await expect(page.getByRole('region', { name: 'Defects board' })).toHaveCount(0)
  await expect(page.getByRole('link', { name: t.defectTitles[0] }).first()).toBeVisible()
  await page.goto(`/defects?projectId=${t.projectId}`)
  await expect(viewSwitch(page, 'List')).toHaveAttribute('aria-pressed', 'true')
})

test('defects: a drag moves a card through the status endpoint; Move to does the same and announces it', async ({ page }) => {
  test.setTimeout(180_000)
  await signIn(page, 'admin')
  await page.goto(`/defects?projectId=${t.projectId}&view=board`)
  const card = (title: string) => page.locator('[data-card]', { hasText: title })
  await expect(card(t.defectTitles[0])).toBeVisible()
  await shot(page, 'defects-board-1280-light')
  // Drag: New -> Assigned.
  await card(t.defectTitles[0]).dragTo(column(page, 'Assigned'))
  await expect(column(page, 'Assigned').getByText(t.defectTitles[0])).toBeVisible({ timeout: 15_000 })
  await expect(column(page, 'New').getByText(t.defectTitles[0])).toHaveCount(0)
  const live = page.getByTestId('board-live')
  await expect(live).toContainText('moved to Assigned')
  expect(await countOf(page, 'Assigned')).toBe(1)
  expect(await countOf(page, 'New')).toBe(2)
  const list = await getJson(page, `/defects?project_id=${t.projectId}&status=Assigned&page_size=10`)
  expect(list.items.map((d: { title: string }) => d.title)).toContain(t.defectTitles[0])

  // Keyboard path: focus the Move to button, open with Enter, choose In Progress with the keys.
  const moveTo = card(t.defectTitles[1]).getByRole('button', { name: /^Move .* to/ })
  await moveTo.focus()
  await page.keyboard.press('Enter')
  const menu = page.getByRole('menu')
  await expect(menu).toBeVisible()
  await expect(menu.getByRole('menuitem', { name: 'Closed' })).toHaveCount(0) // not allowed from New
  await shot(page, 'defects-moveto-menu-1280-light', false)
  await menu.getByRole('menuitem', { name: 'In Progress' }).click()
  await expect(column(page, 'In Progress').getByText(t.defectTitles[1])).toBeVisible({ timeout: 15_000 })
  await expect(live).toContainText('moved to In Progress')

  // A column the workflow does not allow (Assigned -> New): the drop is refused with the reason and nothing changes.
  await card(t.defectTitles[0]).dragTo(column(page, 'New'))
  await expect(page.getByRole('alert')).toContainText('cannot go from Assigned to New')
  await expect(column(page, 'Assigned').getByText(t.defectTitles[0])).toBeVisible()
  await expect(live).toContainText('cannot go from Assigned to New')
})

test('defects: a server refusal is shown and the card stays where it was', async ({ page }) => {
  test.setTimeout(120_000)
  await signIn(page, 'admin')
  await page.goto(`/defects?projectId=${t.projectId}&view=board`)
  await page.route('**/api/v1/defects/*/status', (route) =>
    route.fulfill({
      status: 409,
      contentType: 'application/json',
      body: JSON.stringify({ error: { code: 'conflict', message: 'Defect changed by someone else. Reload and try again.' } }),
    }),
  )
  const title = t.defectTitles[2]
  const card = page.locator('[data-card]', { hasText: title })
  await card.getByRole('button', { name: /^Move .* to/ }).click()
  await page.getByRole('menuitem', { name: 'Assigned' }).click()
  await expect(page.getByRole('alert')).toContainText('Defect changed by someone else')
  await expect(column(page, 'New').getByText(title)).toBeVisible()
  await expect(column(page, 'Assigned').getByText(title)).toHaveCount(0)
  await page.unroute('**/api/v1/defects/*/status')
})

test('defects: a move that needs a resolution opens the Change status dialog instead of guessing', async ({ page }) => {
  test.setTimeout(120_000)
  await signIn(page, 'admin')
  await page.goto(`/defects?projectId=${t.projectId}&view=board`)
  const card = page.locator('[data-card]', { hasText: t.defectTitles[2] })
  await card.getByRole('button', { name: /^Move .* to/ }).click()
  await page.getByRole('menuitem', { name: 'Rejected' }).click()
  const dialog = page.getByRole('dialog', { name: 'Change status' })
  await expect(dialog).toBeVisible()
  await expect(dialog.locator('select#status-target')).toHaveValue('Rejected')
  await dialog.getByRole('button', { name: 'Cancel' }).click()
  await expect(column(page, 'New').getByText(t.defectTitles[2])).toBeVisible()
})

test('test cases: the board is read-only, explains why and its counts equal the API', async ({ page }) => {
  test.setTimeout(180_000)
  await signIn(page, 'admin')
  await page.goto(`/projects/${t.projectId}/test-cases?view=board`)
  const board = page.getByRole('region', { name: 'Test cases board' })
  await expect(board).toBeVisible()
  await expect(board.getByText(/cannot be moved here/)).toBeVisible()
  await expect(board.getByTestId('drag-handle')).toHaveCount(0)
  await expect(board.getByRole('button', { name: /^Move/ })).toHaveCount(0)
  for (const [label, expected] of [
    ['Pass', 1],
    ['Fail', 1],
    ['Not Run', 2],
  ] as const) {
    const api = await getJson(page, `/projects/${t.projectId}/test-cases?execution_status=${encodeURIComponent(label)}&page_size=1`)
    expect(api.total).toBe(expected)
    await expect(column(page, label).getByLabel(/^\d+ in /)).toHaveText(String(expected))
  }
  await expect(column(page, 'Pass').getByRole('link', { name: 'Intake passes' })).toBeVisible()
  await shot(page, 'testcases-board-1280-light')
})

test('test runs: a Manager moves a run with Move to; a Tester gets no controls', async ({ page, browser }) => {
  test.setTimeout(180_000)
  await signIn(page, 'manager')
  await page.goto(`/projects/${t.projectId}/test-runs?view=board`)
  const board = page.getByRole('region', { name: 'Test runs board' })
  await expect(column(page, 'in_progress').getByRole('link', { name: t.runName })).toBeVisible()
  const card = board.locator('[data-card]', { hasText: t.runName })
  await card.getByRole('button', { name: /^Move .* to/ }).click()
  await page.getByRole('menuitem', { name: 'Paused' }).click()
  await expect(column(page, 'paused').getByRole('link', { name: t.runName })).toBeVisible({ timeout: 15_000 })
  const run = await getJson(page, `/test-runs/${t.runId}`)
  expect(run.paused_at).not.toBeNull()
  // Resume it again so later tests see it in progress.
  await board.locator('[data-card]', { hasText: t.runName }).getByRole('button', { name: /^Move .* to/ }).click()
  await page.getByRole('menuitem', { name: 'In progress' }).click()
  await expect(column(page, 'in_progress').getByRole('link', { name: t.runName })).toBeVisible({ timeout: 15_000 })

  const tester = await newPage(browser, { width: 1280, height: 900 })
  await signIn(tester.page, 'tester')
  await tester.page.goto(`/projects/${t.projectId}/test-runs?view=board`)
  await expect(tester.page.getByRole('link', { name: t.runName })).toBeVisible()
  await expect(tester.page.getByTestId('drag-handle')).toHaveCount(0)
  await expect(tester.page.getByRole('button', { name: /^Move/ })).toHaveCount(0)
  await tester.ctx.close()
})

test('calendar: real due dates, runs and a release; entries open records; overdue only; the API agrees', async ({ page }) => {
  test.setTimeout(180_000)
  await signIn(page, 'admin')
  await page.goto(`/projects/${t.projectId}/test-runs?view=calendar`)
  const cal = page.getByRole('region', { name: 'Test run calendar' })
  await expect(cal.getByRole('grid')).toBeVisible()
  const month = day(0).slice(0, 7)
  const from = await page.evaluate((m) => m, month)
  expect(from).toBe(month)
  const link = (name: RegExp) => cal.getByRole('link', { name }).first()
  await expect(link(new RegExp(`Cases due: .*${t.runName}`))).toBeAttached()
  await expect(link(new RegExp(`Release: ${t.releaseName}`))).toBeAttached()
  await expect(link(new RegExp(`Test run: Started: ${t.runName}`))).toBeAttached()
  await shot(page, 'calendar-1280-light')

  // The API for the same window returns exactly these entries.
  const data = await getJson(page, `/calendar?from=${day(-14)}&to=${day(14)}&project_id=${t.projectId}`)
  expect(data.due.map((d: { run_name: string }) => d.run_name).sort()).toEqual([t.lateRunName, t.runName].sort())
  expect(data.releases.map((r: { name: string }) => r.name)).toEqual([t.releaseName])
  const late = data.due.find((d: { run_name: string }) => d.run_name === t.lateRunName)
  expect(late.overdue).toBe(true)

  // Overdue only keeps just the late run's cases.
  if (day(-1).slice(0, 7) === month) {
    await cal.getByLabel('Overdue only').click()
    await expect(page).toHaveURL(/overdue=true/)
    await expect(cal.getByLabel('Overdue only')).toBeChecked()
    await expect(link(new RegExp(`Cases due: .*${t.lateRunName}`))).toBeAttached()
    await expect(cal.getByRole('link', { name: new RegExp(`Release: ${t.releaseName}`) })).toHaveCount(0)
    await cal.getByLabel('Overdue only').click()
    await expect(cal.getByLabel('Overdue only')).not.toBeChecked()
  }

  // Keyboard: arrows move between days and the agenda follows the focused day.
  const today = cal.getByRole('button', { name: /, today,/ })
  await today.focus()
  await page.keyboard.press('ArrowRight')
  await expect(cal.getByRole('region', { name: /^Agenda for/ })).toBeVisible()
  await page.keyboard.press('ArrowLeft')
  await expect(today).toBeFocused()

  // An entry opens its record.
  await cal.getByRole('link', { name: new RegExp(`Test run: Started: ${t.runName}`) }).first().click()
  await expect(page).toHaveURL(new RegExp(`/test-runs/${t.runId}`))
})

test('calendar: month navigation, and the phone shows an agenda list instead of the grid', async ({ browser }) => {
  test.setTimeout(180_000)
  const { ctx, page } = await newPage(browser, { width: 375, height: 812 }, 'dark')
  await signIn(page, 'admin')
  await page.goto(`/projects/${t.projectId}/test-runs?view=calendar`)
  const cal = page.getByRole('region', { name: 'Test run calendar' })
  await expect(cal.getByTestId('calendar-month')).toBeVisible()
  await expect(cal.getByRole('grid')).toHaveCount(0)
  await expect(cal.getByRole('link', { name: new RegExp(`Cases due: .*${t.runName}`) }).first()).toBeVisible()
  expect(await overflowOf(page)).toBeLessThanOrEqual(1)
  // 44px targets on a phone.
  for (const name of ['Previous month', 'Next month', 'Today']) {
    const box = await cal.getByRole('button', { name }).boundingBox()
    expect(box!.height, `${name} height`).toBeGreaterThanOrEqual(43)
  }
  await shot(page, 'calendar-375-dark')
  const before = await cal.getByTestId('calendar-month').innerText()
  await cal.getByRole('button', { name: 'Next month' }).click()
  await expect(cal.getByTestId('calendar-month')).not.toHaveText(before)
  await expect(page).toHaveURL(/month=/)
  await expect(cal.getByText(/Nothing is scheduled in/)).toBeVisible()
  await ctx.close()
})

test('a saved view keeps the mode, and a view saved without one still applies', async ({ page }) => {
  test.setTimeout(120_000)
  await signIn(page, 'admin')
  const body = (name: string, filters: Record<string, string>) => ({ list_key: 'defects', name, filters })
  const mk = async (name: string, filters: Record<string, string>) => {
    const res = await page.request.post(`${API_BASE_URL}/saved-views`, { data: body(name, filters) })
    expect(res.ok(), await res.text()).toBeTruthy()
  }
  await mk('Board view', { view: 'board', projectId: t.projectId })
  await mk('Old style view', { projectId: t.projectId })
  const bad = await page.request.post(`${API_BASE_URL}/saved-views`, { data: body('Bad', { view: 'gantt' }) })
  expect(bad.status()).toBe(422)
  await page.goto(`/defects?projectId=${t.projectId}`)
  await page.getByRole('button', { name: 'Views', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Board view' }).click()
  await expect(page).toHaveURL(/view=board/)
  await expect(page.getByRole('region', { name: 'Defects board' })).toBeVisible()
  await page.getByRole('button', { name: 'Views', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Old style view' }).click()
  // The old view has no mode: the board stays.
  await expect(page.getByRole('region', { name: 'Defects board' })).toBeVisible()
})

test('axe: boards and calendar, light and dark, desktop and phone', async ({ browser }) => {
  test.setTimeout(300_000)
  const problems: string[] = []
  for (const viewport of [
    { width: 1280, height: 900 },
    { width: 375, height: 812 },
  ]) {
    const { ctx, page } = await newPage(browser, viewport)
    await signIn(page, 'admin')
    for (const [label, path, region] of [
      ['defects board', `/defects?projectId=${t.projectId}&view=board`, 'Defects board'],
      ['test cases board', `/projects/${t.projectId}/test-cases?view=board`, 'Test cases board'],
      ['runs board', `/projects/${t.projectId}/test-runs?view=board`, 'Test runs board'],
      ['runs calendar', `/projects/${t.projectId}/test-runs?view=calendar`, 'Test run calendar'],
    ] as const) {
      await page.goto(path)
      await expect(page.getByRole('region', { name: region })).toBeVisible()
      await expect(page.locator('[aria-busy="true"]')).toHaveCount(0, { timeout: 15_000 })
      await axeBothThemes(page, `${label} @${viewport.width}`, problems)
      expect(await overflowOf(page), `${label} @${viewport.width} overflows horizontally`).toBeLessThanOrEqual(1)
    }
    await ctx.close()
  }
  expect(problems).toEqual([])
})
