import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test'

import { axeFindings, formatFindings } from './a11y'
import { API_BASE_URL, bootstrapTenant, loginViaUi, seedDefectBody, type SeededTenant } from './fixtures'

// ADR-123: the project Overview as a configurable dashboard. Real backend, one throwaway tenant:
// project "Overview Co" with two modules, cases in every execution state, run due dates, a release,
// defects, plus a second project whose numbers must never leak in. Each KPI is compared with the
// report API and with the list it links to; the layout is customised, reset and published as the
// project default; a case-scoped Tester sees only their own cases; the organisation dashboard stays
// a separate page. Set OVERVIEW_SHOTS_DIR to also write screenshots.

const SHOTS = process.env.OVERVIEW_SHOTS_DIR
const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10)

interface Ctx extends SeededTenant {
  managerEmail: string
  testerEmail: string
  managerPassword: string
  testerPassword: string
  projectId: string
  otherProjectId: string
  runId: string
  run2Id: string
  overdueTitle: string
  upcomingRunName: string
  releaseName: string
}
let t: Ctx

test.describe.configure({ mode: 'serial' })

const overflowOf = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)

async function shot(page: Page, name: string) {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true })
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

const kpi = (page: Page, key: string) => page.locator(`[data-testid="kpi-${key}"] a`)
async function kpiValue(page: Page, key: string): Promise<number> {
  return Number(await kpi(page, key).getAttribute('data-value'))
}
const widgetOrder = (page: Page) => page.locator('[data-widget]').evaluateAll((els) => els.map((e) => e.getAttribute('data-widget')))
async function listedTotal(page: Page): Promise<number> {
  const text = await page.getByText(/Showing \d+-\d+ of \d+/).first().innerText()
  return Number(/of (\d+)/.exec(text)![1])
}

test.beforeAll(async ({ request }) => {
  test.setTimeout(300_000)
  const tenant = await bootstrapTenant(request, 'OvDash')
  const suffix = tenant.tenantId.slice(0, 8)
  const login = await request.post(`${API_BASE_URL}/auth/login`, {
    data: { tenant_id: tenant.tenantId, email: tenant.adminEmail, password: tenant.adminPassword },
  })
  expect(login.ok(), await login.text()).toBeTruthy()
  const verify = await request.post(`${API_BASE_URL}/auth/mfa/verify`, {
    data: { code: (await login.json()).data.debug_code },
  })
  expect(verify.ok(), await verify.text()).toBeTruthy()
  const post = async (path: string, data?: unknown, method: 'post' | 'patch' = 'post') => {
    const res = await request[method](`${API_BASE_URL}${path}`, { data })
    expect(res.ok(), `${path}: ${await res.text()}`).toBeTruthy()
    return (await res.json()).data
  }
  const user = async (role: 'manager' | 'tester', password: string) => {
    const email = `${role}-${suffix}@example.com`
    const created = await post('/users', { email, name: `${role[0].toUpperCase()}${role.slice(1)} E2E`, role, password })
    return { email, password, id: created.id as string }
  }
  const manager = await user('manager', 'ManagerPassw0rd1!')
  const tester = await user('tester', 'TesterPassw0rd1!')
  const mkProject = async (name: string) => {
    const p = await post('/projects', {
      name,
      domain: 'Motor',
      priority: 'High',
      manager_name: 'Jane Manager',
      start_date: '2026-01-01',
      end_date: '2026-12-31',
      budget: '1000.00',
      region: 'North America',
    })
    for (const m of [manager, tester]) await post(`/projects/${p.id}/members`, { user_id: m.id })
    return p.id as string
  }
  const projectId = await mkProject('Overview Co')
  const otherProjectId = await mkProject('Elsewhere Ltd')
  const modA = (await post(`/projects/${projectId}/modules`, { name: 'Claims intake' })).id
  const modB = (await post(`/projects/${projectId}/modules`, { name: 'Payouts' })).id
  const mkCase = async (pid: string, mod: string, title: string) => {
    const tc = await post(`/projects/${pid}/test-cases`, {
      title,
      priority: 'High',
      module_id: mod,
      preconditions: 'The claim exists',
      test_data: 'claim=C-100',
      expected_result: 'It works',
      steps: [
        { action: 'Open the claim', expected: 'Opens' },
        { action: 'Settle the claim', expected: 'Settled' },
      ],
    })
    await post(`/test-cases/${tc.id}/submit-review`, {})
    await post(`/test-cases/${tc.id}/approve`)
    return tc.id as string
  }
  const c1 = await mkCase(projectId, modA, 'Intake passes')
  const c2 = await mkCase(projectId, modA, 'Intake fails')
  const c3 = await mkCase(projectId, modB, 'Payout blocked')
  const overdueTitle = 'Payout waiting past due'
  const c4 = await mkCase(projectId, modB, overdueTitle)
  const c5 = await mkCase(projectId, modB, 'Payout due soon')
  await mkCase(projectId, modB, 'Payout never planned')
  const runName = 'Regression sweep'
  const run = await post(`/projects/${projectId}/test-runs`, {
    name: runName,
    run_type: 'Regression',
    test_case_ids: [c1, c2, c3, c4],
    due_date: day(-3),
  })
  const rcOf = (r: { cases: { id: string; test_case_id: string }[] }, id: string) => r.cases.find((c) => c.test_case_id === id)!.id
  const verdictAll = async (rc: string, verdict: 'pass' | 'fail') => {
    const steps = (await (await request.get(`${API_BASE_URL}/test-run-cases/${rc}/steps`)).json()).data
    for (const s of steps) {
      await post(`/execution-steps/${s.id}/verdict`, { verdict, ...(verdict === 'fail' ? { actual_result: 'It broke' } : {}) })
    }
  }
  await verdictAll(rcOf(run, c1), 'pass')
  await verdictAll(rcOf(run, c2), 'fail')
  await post(`/test-run-cases/${rcOf(run, c3)}/block`, { reason: 'Payment sandbox is down' })
  const upcomingRunName = 'Hardening run'
  const run2 = await post(`/projects/${projectId}/test-runs`, {
    name: upcomingRunName,
    run_type: 'Smoke',
    test_case_ids: [c5],
  })
  // c4 (overdue, pending) and c5 (due in 4 days) are assigned to the Tester, who therefore sees them
  // when case visibility is restricted.
  await post(`/test-run-cases/${rcOf(run, c4)}/assign`, { assigned_to: tester.id }, 'patch')
  await post(`/test-run-cases/${rcOf(run2, c5)}/assign`, { assigned_to: tester.id, due_date: day(4) }, 'patch')
  const releaseName = 'Release 9.1'
  await post(`/projects/${projectId}/releases`, { name: releaseName, release_date: day(9), status: 'Planned' })
  await post(`/projects/${projectId}/releases`, { name: 'Shipped long ago', release_date: day(-20), status: 'Released' })
  await post('/defects', seedDefectBody(projectId, { title: 'Settlement total is wrong', severity: 'Critical' }))
  await post('/defects', seedDefectBody(projectId, { title: 'Typo on the intake form', severity: 'Low' }))
  const q = await mkCase(otherProjectId, (await post(`/projects/${otherProjectId}/modules`, { name: 'Other' })).id, 'Elsewhere case')
  const otherRun = await post(`/projects/${otherProjectId}/test-runs`, { name: 'Elsewhere run', run_type: 'Smoke', test_case_ids: [q] })
  await verdictAll(otherRun.cases[0].id, 'pass')
  await post('/defects', seedDefectBody(otherProjectId, { title: 'Elsewhere defect', severity: 'High' }))
  await post('/settings', { testers_see_assigned_cases_only: true }, 'patch')
  await request.post(`${API_BASE_URL}/auth/logout`)
  t = {
    ...tenant,
    managerEmail: manager.email,
    managerPassword: manager.password,
    testerEmail: tester.email,
    testerPassword: tester.password,
    projectId,
    otherProjectId,
    runId: run.id,
    run2Id: run2.id,
    overdueTitle,
    upcomingRunName,
    releaseName,
  }
})

test('admin: every key number equals the API and the list it links to, and nothing leaks from another project', async ({
  page,
}) => {
  test.setTimeout(240_000)
  await signIn(page, 'admin')
  const requests: string[] = []
  page.on('request', (r) => {
    const u = r.url()
    if (/\/api\/v1\/(reports|dashboard|my-work|defects)/.test(u) || /\/projects\/[^/]+\/(requirements|dashboard)/.test(u)) requests.push(u)
  })
  await page.goto(`/projects/${t.projectId}`)
  await expect(page.getByRole('heading', { level: 1, name: 'Overview Co' })).toBeVisible()
  await expect(kpi(page, 'total')).toHaveAttribute('data-value', '6', { timeout: 30_000 })

  const status = await getJson(page, `/reports/project-test-status?project_id=${t.projectId}`)
  expect(status).toMatchObject({ total: 6, executed: 3, passed: 1, failed: 1, blocked: 1, not_run: 3 })
  const summary = await getJson(page, `/dashboard/summary?project_id=${t.projectId}`)
  const open = Object.values(summary.defects.open_by_severity as Record<string, number>).reduce((a, b) => a + b, 0)
  expect(open).toBe(2)
  const expected: Record<string, number> = {
    total: status.total,
    executed: status.executed,
    passed: status.passed,
    failed: status.failed,
    blocked: status.blocked,
    'not-run': status.not_run,
    'open-defects': open,
    'critical-defects': summary.defects.critical_count,
  }
  for (const [key, value] of Object.entries(expected)) {
    await expect(kpi(page, key), key).toHaveAttribute('data-value', String(value))
  }
  // The same numbers come from the underlying list endpoints.
  const listTotal = async (qs: string) =>
    (await getJson(page, `/projects/${t.projectId}/test-cases?page_size=1&${qs}`)).total as number
  expect(await listTotal('')).toBe(status.total)
  expect(await listTotal('execution_status=Executed')).toBe(status.executed)
  expect(await listTotal('execution_status=Pass')).toBe(status.passed)
  expect(await listTotal('execution_status=Fail')).toBe(status.failed)
  expect(await listTotal('execution_status=Blocked')).toBe(status.blocked)
  expect(await listTotal('execution_status=Not Run')).toBe(status.not_run)
  // Every request carried this project and none the other one.
  expect(requests.length).toBeGreaterThan(0)
  expect(requests.filter((u) => u.includes(t.otherProjectId))).toEqual([])
  expect(
    requests.filter((u) => /\/(reports|dashboard)\//.test(u) && !u.includes(`project_id=${t.projectId}`) && !u.includes('/reports/traceability')),
  ).toEqual([])
  // The header progress comes from the same aggregate.
  await expect(page.getByTestId('project-progress')).toContainText('50% executed (3/6) · 33% case pass rate')
  await shot(page, 'overview-admin-1280')

  // Each KPI opens a list that applies the filter: the list total equals the tile.
  for (const [key, label, path] of [
    ['passed', 'Passed', 'executionStatus=Pass'],
    ['failed', 'Failed', 'executionStatus=Fail'],
    ['blocked', 'Blocked', 'executionStatus=Blocked'],
    ['not-run', 'Not run', 'executionStatus=Not\\+Run'],
    ['executed', 'Executed', 'executionStatus=Executed'],
  ] as const) {
    await page.goto(`/projects/${t.projectId}`)
    await expect(kpi(page, key)).toHaveAttribute('data-value', String(expected[key]))
    await kpi(page, key).click()
    await expect(page, label).toHaveURL(new RegExp(`/projects/${t.projectId}/test-cases[?]${path}`))
    await expect(page.getByText(/Showing \d+-\d+ of \d+/).first()).toBeVisible({ timeout: 20_000 })
    expect(await listedTotal(page), label).toBe(expected[key])
  }
  await page.goto(`/projects/${t.projectId}`)
  await kpi(page, 'open-defects').click()
  await expect(page).toHaveURL(new RegExp(`/defects[?]projectId=${t.projectId}&status=`))
  await expect(page.getByText('Settlement total is wrong')).toBeVisible({ timeout: 20_000 })
  expect(await listedTotal(page)).toBe(open)
  await page.goto(`/projects/${t.projectId}`)
  await kpi(page, 'critical-defects').click()
  await expect(page).toHaveURL(/severity=Critical/)
  await expect(page.getByText('Settlement total is wrong')).toBeVisible({ timeout: 20_000 })
  await expect(page.getByText('Typo on the intake form')).toHaveCount(0)
  expect(await listedTotal(page)).toBe(summary.defects.critical_count)

  // Module coverage rows equal the module-filtered list.
  await page.goto(`/projects/${t.projectId}`)
  const modules = (await getJson(page, `/reports/module-coverage?project_id=${t.projectId}`)).rows as { module_id: string; module_name: string; total: number }[]
  expect(modules.map((m) => m.module_name).sort()).toEqual(['Claims intake', 'Payouts'])
  const payouts = modules.find((m) => m.module_name === 'Payouts')!
  await expect(page.getByRole('link', { name: 'Payouts' }).first()).toBeVisible({ timeout: 20_000 })
  await page.getByRole('link', { name: 'Payouts' }).first().click()
  await expect(page).toHaveURL(new RegExp(`moduleId=${payouts.module_id}`))
  await expect(page.getByText(/Showing \d+-\d+ of \d+/).first()).toBeVisible({ timeout: 20_000 })
  expect(await listedTotal(page)).toBe(payouts.total)
})

test('operational widgets: overdue and upcoming come from real due dates and link to the records', async ({ page }) => {
  test.setTimeout(240_000)
  await signIn(page, 'admin')
  await page.goto(`/projects/${t.projectId}`)
  const overdue = page.getByTestId('widget-overdue_cases')
  await expect(overdue.getByText(t.overdueTitle)).toBeVisible({ timeout: 30_000 })
  await expect(overdue.getByTestId('overdue-total')).toHaveAttribute('data-value', '1')
  await expect(overdue.getByText('3 days overdue')).toBeVisible()
  // Executed and blocked run cases of the same overdue run are not listed.
  for (const gone of ['Intake passes', 'Intake fails', 'Payout blocked']) await expect(overdue.getByText(gone)).toHaveCount(0)
  const api = await getJson(page, `/reports/overdue-run-cases?project_id=${t.projectId}`)
  expect(api.total).toBe(1)

  const upcoming = page.getByTestId('widget-upcoming_milestones')
  await expect(upcoming.getByText(t.upcomingRunName)).toBeVisible()
  await expect(upcoming.getByText(t.releaseName)).toBeVisible()
  await expect(upcoming.getByText('Shipped long ago')).toHaveCount(0)
  await expect(upcoming.getByText('Due in 4 days')).toBeVisible()
  await expect(upcoming.getByText('Due in 9 days')).toBeVisible()
  await shot(page, 'overdue-upcoming-1280')
  await upcoming.getByRole('link', { name: new RegExp(t.upcomingRunName) }).click()
  await expect(page).toHaveURL(new RegExp(`/test-runs/${t.run2Id}$`))

  // "View" lands on an Execution Console queue that applies project and overdue filters.
  await page.goto(`/projects/${t.projectId}`)
  await page.getByRole('link', { name: 'View Overdue test cases' }).click()
  await expect(page).toHaveURL(new RegExp(`/execution[?]projectId=${t.projectId}&overdue=1`))
  await expect(page.getByTestId('execution-filter-note')).toContainText('overdue')
  await expect(page.getByText(t.overdueTitle)).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText('3 days overdue')).toBeVisible()
  await expect(page.getByText('Payout due soon')).toHaveCount(0)
  await expect(page.locator('ul > li a[href^="/test-run-cases/"]')).toHaveCount(api.total)
  await page.getByRole('button', { name: 'Show everything' }).click()
  await expect(page.getByText('Payout due soon')).toBeVisible({ timeout: 30_000 })

  // Recent defects and the severity widget link to records.
  await page.goto(`/projects/${t.projectId}`)
  const recent = page.getByTestId('widget-recent_defects')
  await expect(recent.getByText('Settlement total is wrong')).toBeVisible({ timeout: 30_000 })
  await expect(recent.getByText('Elsewhere defect')).toHaveCount(0)
  await recent.getByRole('link', { name: /Settlement total is wrong/ }).click()
  await expect(page).toHaveURL(/\/defects\/[0-9a-f-]{36}/)
})

test('run assignment: the due date is editable per run case and shows in My Work and the console', async ({ browser, page }) => {
  test.setTimeout(240_000)
  await signIn(page, 'admin')
  await page.goto(`/test-runs/${t.runId}`)
  const due = page.getByLabel('Due date for Payout waiting past due')
  await expect(due).toBeVisible({ timeout: 30_000 })
  await expect(due).toHaveValue(day(-3))
  await due.fill(day(-1))
  await expect(page.getByText('Due date updated')).toBeVisible()
  const run = await getJson(page, `/test-runs/${t.runId}`)
  const rc = run.cases.find((c: { title: string }) => c.title === t.overdueTitle)
  expect(rc.due_date).toBe(day(-1))
  expect(rc.assigned_to).not.toBeNull() // changing the date left the assignee alone
  await due.fill('')
  await expect(page.getByText('Due date updated').first()).toBeVisible()
  await expect.poll(async () => (await getJson(page, `/test-runs/${t.runId}`)).cases.find((c: { title: string }) => c.title === t.overdueTitle).due_date).toBeNull()
  await due.fill(day(-3))
  await expect.poll(async () => (await getJson(page, `/test-runs/${t.runId}`)).cases.find((c: { title: string }) => c.title === t.overdueTitle).due_date).toBe(day(-3))

  const { ctx, page: tp } = await newPage(browser, { width: 1280, height: 900 })
  try {
    await signIn(tp, 'tester')
    await tp.goto('/my-work')
    const row = tp.getByRole('link', { name: new RegExp(t.overdueTitle) })
    await expect(row).toBeVisible({ timeout: 30_000 })
    await expect(row).toContainText('3 days overdue')
    await expect(tp.getByRole('link', { name: /Payout due soon/ })).toContainText('Due in 4 days')
    await row.click()
    await expect(tp.getByText(/\(overdue\)/)).toBeVisible({ timeout: 20_000 })
  } finally {
    await ctx.close()
  }
})

test('customise: show, hide and order widgets, reset, per-user layouts and the project default', async ({ browser, page }) => {
  test.setTimeout(300_000)
  await signIn(page, 'admin')
  await page.goto(`/projects/${t.projectId}`)
  await expect(kpi(page, 'total')).toBeVisible({ timeout: 30_000 })
  const builtin = await widgetOrder(page)
  expect(builtin[0]).toBe('kpi_strip')
  expect(builtin).toHaveLength(15)

  await page.getByTestId('project-quick-actions').getByRole('button', { name: 'Customise' }).click()
  const panel = page.getByRole('dialog', { name: 'Customise dashboard' })
  await expect(panel).toBeVisible()
  await expect(panel.getByRole('button', { name: 'Save', exact: true })).toBeDisabled()
  await shot(page, 'customise-1280')
  await panel.getByRole('button', { name: 'Move Test execution trend up' }).click()
  await expect(panel.getByRole('button', { name: 'Move Test execution trend up' })).toBeFocused()
  await panel.getByRole('checkbox', { name: /Tester performance/ }).uncheck()
  await panel.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.getByText('Dashboard layout saved')).toBeVisible()
  const mine = await widgetOrder(page)
  expect(mine.slice(0, 3)).toEqual(['kpi_strip', 'execution_trend', 'test_status'])
  expect(mine).not.toContain('tester_performance')
  expect(mine).toHaveLength(14)
  // It persists across a reload, and the stored layout is the visible widgets in order.
  await page.reload()
  await expect(kpi(page, 'total')).toBeVisible({ timeout: 30_000 })
  expect(await widgetOrder(page)).toEqual(mine)
  const stored = await getJson(page, `/projects/${t.projectId}/dashboard`)
  expect(stored.layout_source).toBe('user')
  expect(stored.widgets.map((w: { widget_type: string }) => w.widget_type)).toEqual(mine)

  // Another user still has the built-in layout (layouts are per user).
  const mctx = await browser.newContext()
  const mp = await mctx.newPage()
  await signIn(mp, 'manager')
  await mp.goto(`/projects/${t.projectId}`)
  await expect(mp.locator('[data-testid="kpi-total"] a')).toBeVisible({ timeout: 30_000 })
  expect(await widgetOrder(mp)).toEqual(builtin)
  await mctx.close()

  // Hiding everything is a valid layout and says so.
  await page.getByTestId('project-quick-actions').getByRole('button', { name: 'Customise' }).click()
  for (const box of await panel.getByRole('checkbox').all()) await box.uncheck()
  await panel.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.getByText('Every widget is hidden')).toBeVisible()

  // Reset returns to the built-in layout.
  await page.getByTestId('project-quick-actions').getByRole('button', { name: 'Customise' }).click()
  await panel.getByRole('button', { name: 'Reset to default' }).click()
  await expect(page.getByText('Dashboard layout reset')).toBeVisible()
  await expect(kpi(page, 'total')).toBeVisible({ timeout: 30_000 })
  expect(await widgetOrder(page)).toEqual(builtin)

  // The Admin (project.edit) publishes a project default that hides two widgets.
  await page.getByTestId('project-quick-actions').getByRole('button', { name: 'Customise' }).click()
  await expect(panel.getByTestId('customise-default')).toBeVisible()
  await panel.getByRole('checkbox', { name: /Tester workload/ }).uncheck()
  await panel.getByRole('checkbox', { name: /Recent activity/ }).uncheck()
  await panel.getByRole('button', { name: 'Save as project default' }).click()
  await expect(page.getByText('Project default layout saved')).toBeVisible()
  expect(await widgetOrder(page)).toEqual(builtin.filter((w) => w !== 'tester_workload' && w !== 'recent_activity'))

  // A Tester sees the default, may keep their own layout, and has no way to publish a default.
  const tctx = await browser.newContext()
  const tp = await tctx.newPage()
  await signIn(tp, 'tester')
  await tp.goto(`/projects/${t.projectId}`)
  await expect(tp.locator('[data-testid="kpi-total"] a')).toBeVisible({ timeout: 30_000 })
  const def = builtin.filter((w) => w !== 'tester_workload' && w !== 'recent_activity')
  expect(await widgetOrder(tp)).toEqual(def)
  await tp.getByTestId('project-quick-actions').getByRole('button', { name: 'Customise' }).click()
  const tpanel = tp.getByRole('dialog', { name: 'Customise dashboard' })
  await expect(tpanel.getByTestId('customise-default')).toHaveCount(0)
  await expect(tpanel.getByText("using this project's default layout")).toBeVisible()
  await tpanel.getByRole('checkbox', { name: /Recently reported defects/ }).uncheck()
  await tpanel.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(tp.getByText('Dashboard layout saved')).toBeVisible()
  expect(await widgetOrder(tp)).toEqual(def.filter((w) => w !== 'recent_defects'))
  const refused = await tp.request.put(`${API_BASE_URL}/projects/${t.projectId}/dashboard/default`, { data: { widgets: [] } })
  expect(refused.status()).toBe(403)
  await tctx.close()

  // Removing the default puts everyone without their own layout back on the built-in one.
  await page.getByTestId('project-quick-actions').getByRole('button', { name: 'Customise' }).click()
  await panel.getByRole('button', { name: 'Remove project default' }).click()
  await expect(page.getByText('Project default layout removed')).toBeVisible()
  expect(await widgetOrder(page)).toEqual(builtin)
})

test('a case-scoped Tester sees only their own numbers, still through the same lists', async ({ browser }) => {
  test.setTimeout(240_000)
  const { ctx, page } = await newPage(browser, { width: 1280, height: 900 })
  try {
    await signIn(page, 'tester')
    await page.goto(`/projects/${t.projectId}`)
    await expect(kpi(page, 'total')).toHaveAttribute('data-value', '2', { timeout: 30_000 })
    const status = await getJson(page, `/reports/project-test-status?project_id=${t.projectId}`)
    expect(status).toMatchObject({ total: 2, executed: 0, not_run: 2 })
    expect(await kpiValue(page, 'not-run')).toBe(2)
    expect(await kpiValue(page, 'passed')).toBe(0)
    await kpi(page, 'not-run').click()
    await expect(page.getByText(/Showing \d+-\d+ of \d+/).first()).toBeVisible({ timeout: 20_000 })
    expect(await listedTotal(page)).toBe(2)
    await page.goto(`/projects/${t.projectId}`)
    // The tester's overdue widget holds only the run case assigned to them.
    const overdue = page.getByTestId('widget-overdue_cases')
    await expect(overdue.getByText(t.overdueTitle)).toBeVisible({ timeout: 30_000 })
    await expect(overdue.getByTestId('overdue-total')).toHaveAttribute('data-value', '1')
    // My pending shows their open run cases of this project only.
    const mine = page.getByTestId('widget-my_pending')
    await expect(mine.getByText(t.overdueTitle)).toBeVisible()
    await expect(mine.getByText('Payout due soon')).toBeVisible()
    await shot(page, 'overview-tester-1280')
  } finally {
    await ctx.close()
  }
})

test('the organisation dashboard stays a separate page for all projects', async ({ page }) => {
  test.setTimeout(180_000)
  await signIn(page, 'admin')
  await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible()
  await expect(page.getByText('Current testing status and project health at a glance.')).toBeVisible()
  await expect(page.getByTestId('overview-grid')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Customise' })).toHaveCount(0)
  await expect(page.getByRole('combobox', { name: 'Project' })).toContainText('All projects')
  // The project Overview says it is this project only and links back to the all-projects page.
  await page.goto(`/projects/${t.projectId}`)
  await expect(page.getByTestId('overview-scope')).toContainText('Overview Co only')
  await page.getByRole('link', { name: 'See all projects' }).click()
  await expect(page).toHaveURL(/\/$/)
  await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible()
  // Project layouts never show up among the personal dashboards.
  const list = await getJson(page, '/dashboards')
  expect(list).toEqual([])
})

for (const [label, width, height] of [
  ['phone', 375, 812],
  ['tablet', 768, 1024],
] as const) {
  test(`${label} layout: no horizontal overflow and the key numbers stay readable`, async ({ browser }) => {
    test.setTimeout(180_000)
    const { ctx, page } = await newPage(browser, { width, height })
    try {
      await signIn(page, 'admin')
      await page.goto(`/projects/${t.projectId}`)
      await expect(kpi(page, 'total')).toHaveAttribute('data-value', '6', { timeout: 30_000 })
      await expect(page.getByTestId('widget-overdue_cases').getByText(t.overdueTitle)).toBeVisible({ timeout: 30_000 })
      expect(await overflowOf(page)).toBeLessThanOrEqual(0)
      for (const key of ['total', 'passed', 'critical-defects']) {
        const box = await page.locator(`[data-testid="kpi-${key}"]`).boundingBox()
        expect(box!.width).toBeGreaterThan(70)
        expect(box!.x + box!.width).toBeLessThanOrEqual(width)
      }
      await page.getByTestId('project-quick-actions').getByRole('button', { name: 'Customise' }).click()
      const panel = page.getByRole('dialog', { name: 'Customise dashboard' })
      await expect(panel).toBeVisible()
      expect(await overflowOf(page)).toBeLessThanOrEqual(0)
      await shot(page, `customise-${width}`)
      await panel.getByRole('button', { name: 'Cancel' }).click()
      await shot(page, `overview-${width}`)
    } finally {
      await ctx.close()
    }
  })
}

for (const theme of ['light', 'dark'] as const) {
  test(`axe: project Overview, Customise panel and the run due date column (${theme})`, async ({ browser }) => {
    test.setTimeout(240_000)
    const { ctx, page } = await newPage(browser, { width: 1280, height: 900 }, theme)
    try {
      await signIn(page, 'admin')
      await page.goto(`/projects/${t.projectId}`)
      await expect(kpi(page, 'total')).toHaveAttribute('data-value', '6', { timeout: 30_000 })
      await expect(page.getByTestId('widget-overdue_cases').getByText(t.overdueTitle)).toBeVisible({ timeout: 30_000 })
      await expect(page.getByTestId('widget-recent_defects').getByText('Settlement total is wrong')).toBeVisible()
      await page.waitForLoadState('networkidle')
      await shot(page, `overview-1280-${theme}`)
      expect(formatFindings(`project overview ${theme}`, await axeFindings(page))).toEqual([])
      await page.getByTestId('project-quick-actions').getByRole('button', { name: 'Customise' }).click()
      await expect(page.getByRole('dialog', { name: 'Customise dashboard' })).toBeVisible()
      await shot(page, `customise-1280-${theme}`)
      expect(formatFindings(`customise ${theme}`, await axeFindings(page, {}, '[role="dialog"]'))).toEqual([])
      await page.keyboard.press('Escape')
      await page.goto(`/test-runs/${t.runId}`)
      await expect(page.getByLabel('Due date for Payout waiting past due')).toBeVisible({ timeout: 30_000 })
      expect(formatFindings(`run due dates ${theme}`, await axeFindings(page))).toEqual([])
      await page.goto(`/execution?projectId=${t.projectId}&overdue=1`)
      await expect(page.getByText(t.overdueTitle)).toBeVisible({ timeout: 30_000 })
      expect(formatFindings(`execution overdue ${theme}`, await axeFindings(page))).toEqual([])
    } finally {
      await ctx.close()
    }
  })
}

test('screenshots (only with OVERVIEW_SHOTS_DIR): the Overview at four widths in light and dark', async ({ browser }) => {
  test.skip(!SHOTS, 'set OVERVIEW_SHOTS_DIR to capture screenshots')
  test.setTimeout(600_000)
  for (const theme of ['light', 'dark'] as const) {
    for (const width of [1440, 1280, 768, 375]) {
      const { ctx, page } = await newPage(browser, { width, height: width < 800 ? 900 : 900 }, theme)
      try {
        await signIn(page, 'admin')
        await page.goto(`/projects/${t.projectId}`)
        await expect(kpi(page, 'total')).toHaveAttribute('data-value', '6', { timeout: 30_000 })
        await expect(page.getByTestId('widget-overdue_cases').getByText(t.overdueTitle)).toBeVisible({ timeout: 30_000 })
        await expect(page.getByTestId('widget-recent_defects').getByText('Settlement total is wrong')).toBeVisible()
        await page.waitForLoadState('networkidle')
        await shot(page, `ov-${width}-${theme}`)
        await page.getByTestId('project-quick-actions').getByRole('button', { name: 'Customise' }).click()
        await expect(page.getByRole('dialog', { name: 'Customise dashboard' })).toBeVisible()
        await shot(page, `ov-customise-${width}-${theme}`)
      } finally {
        await ctx.close()
      }
    }
  }
})
