import { expect, test, type Page } from '@playwright/test'

import { axeFindings, formatFindings } from './a11y'
import { API_BASE_URL, loginViaUi, seedDefectBody, seedCaseBody } from './fixtures'
import { seedRoleTenant } from './roleTenant'

// ADR-102: every project opens on its own read-only Dashboard tab. Real backend,
// own throwaway tenant, two projects with different case/defect counts.

async function post(page: Page, path: string, data?: unknown) {
  const response = await page.request.post(`${API_BASE_URL}${path}`, { data })
  if (!response.ok()) throw new Error(`POST ${path} failed (${response.status()}): ${await response.text()}`)
  return (await response.json()).data
}

async function seedProject(page: Page, name: string, adminId: string, cases: number, defects: number) {
  const created = await post(page, '/projects', {
    name,
    domain: 'Motor',
    priority: 'High',
    manager_name: 'Jane Manager',
    start_date: '2026-01-01',
    end_date: '2026-12-31',
    budget: '1000.00',
    region: 'North America',
  })
  if (!created.assigned_user_ids.includes(adminId)) {
    await post(page, `/projects/${created.id}/members`, { user_id: adminId })
  }
  for (let i = 1; i <= cases; i++) {
    const tc = await post(page, `/projects/${created.id}/test-cases`, await seedCaseBody(page.request, created.id, {
      title: `${name} case ${i}`,
      priority: 'High',
      steps: [{ action: 'Open', expected: 'Opens' }],
    }))
    await post(page, `/test-cases/${tc.id}/submit-review`, {})
    await post(page, `/test-cases/${tc.id}/approve`)
  }
  for (let i = 1; i <= defects; i++) {
    await post(page, '/defects', seedDefectBody(created.id, { title: `${name} defect ${i}`, description: 'd' }))
  }
  return created.id as string
}

test('project dashboard: default tab, scoped numbers, tabs, details, breadcrumb, no access, mobile, axe', async ({
  page,
  browser,
  request,
}) => {
  test.setTimeout(240_000)
  const t = await seedRoleTenant(request, 'ProjDash', { withData: true })
  await loginViaUi(page, t.tenantId, t.adminEmail, t.adminPassword)
  const me = await (await page.request.get(`${API_BASE_URL}/auth/me`)).json()
  const adminId = (me.data?.user_id ?? me.data?.id) as string
  const a = await seedProject(page, 'Alpha Project', adminId, 3, 2)
  const b = await seedProject(page, 'Beta Project', adminId, 1, 0)

  // Project A: Dashboard is the default tab and every widget request carries A's id.
  const scoped: string[] = []
  page.on('request', (r) => {
    const u = r.url()
    // The phone tab bar's badge count is deliberately tenant-wide (ADR-104).
    if (/\/api\/v1\/(dashboard|reports|defects)/.test(u) && !u.endsWith('/defects/status-counts')) scoped.push(u)
  })
  await page.goto(`/projects/${a}`)
  await expect(page.getByRole('heading', { level: 1, name: 'Alpha Project' })).toBeVisible()
  // ADR-123: the Overview is the configurable dashboard (key numbers plus widgets).
  for (const h of ['Pass / fail distribution', 'Test execution trend (30 days)', 'Overdue test cases']) {
    await expect(page.getByRole('heading', { level: 2, name: h })).toBeVisible()
  }
  await expect(
    page.getByRole('navigation', { name: 'Project sections' }).getByRole('link', { name: 'Overview', exact: true }),
  ).toHaveAttribute('aria-current', 'page')
  await expect(page.locator('[data-testid="kpi-total"] a')).toHaveAttribute('data-value', '3', { timeout: 20_000 })
  expect(scoped.length).toBeGreaterThan(0)
  expect(scoped.filter((u) => !u.includes(`project_id=${a}`) && !u.includes(`projectId=${a}`))).toEqual([])
  await expect(page.getByRole('navigation', { name: 'Breadcrumb' })).toContainText('Alpha Project')
  await expect(page.getByRole('navigation', { name: 'Breadcrumb' })).toContainText('Overview')

  // axe on the dashboard tab.
  const findings = await axeFindings(page)
  expect(formatFindings('project dashboard', findings)).toEqual([])

  // Project B shows different numbers.
  await page.goto(`/projects/${b}`)
  await expect(page.getByRole('heading', { level: 1, name: 'Beta Project' })).toBeVisible()
  await expect(page.locator('[data-testid="kpi-total"] a')).toHaveAttribute('data-value', '1', { timeout: 20_000 })

  // Tab strip links.
  await page.goto(`/projects/${a}`)
  const tabs = page.getByRole('navigation', { name: 'Project sections' })
  await tabs.getByRole('link', { name: 'Test Cases' }).click()
  await expect(page).toHaveURL(new RegExp(`/projects/${a}/test-cases$`))
  await page.goto(`/projects/${a}`)
  await tabs.getByRole('link', { name: 'Requirements' }).click()
  await expect(page).toHaveURL(new RegExp(`/projects/${a}/requirements$`))
  await page.goto(`/projects/${a}`)
  await tabs.getByRole('link', { name: 'Defects' }).click()
  await expect(page).toHaveURL(new RegExp(`/defects[?]projectId=${a}`))

  // ADR-122: the old Details content is split over Team, Settings, Planning, Releases and Activity.
  await page.goto(`/projects/${a}`)
  await tabs.getByRole('link', { name: 'Team' }).click()
  await expect(page).toHaveURL(new RegExp(`/projects/${a}/team$`))
  await expect(page.getByRole('heading', { name: 'Team Members' })).toBeVisible()
  await expect(page.getByRole('navigation', { name: 'Breadcrumb' })).toContainText('Team')
  // The old /details URL still works and shows the same cards together.
  await page.goto(`/projects/${a}/details`)
  await expect(page.getByRole('heading', { name: 'Team Members' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Test run status' })).toBeVisible()
  await expect(page.getByRole('navigation', { name: 'Breadcrumb' })).toContainText('Details')

  // No horizontal overflow at 390.
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(`/projects/${a}`)
  await expect(page.locator('[data-testid="kpi-total"] a')).toHaveAttribute('data-value', '3', { timeout: 20_000 })
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  expect(overflow).toBeLessThanOrEqual(0)

  // A Tester who is not a member cannot open it.
  const ctx = await browser.newContext()
  const tp = await ctx.newPage()
  await loginViaUi(tp, t.tenantId, t.tester.email, t.tester.password)
  await tp.goto(`/projects/${a}`)
  await expect(tp.getByRole('heading', { level: 1, name: 'Alpha Project' })).toHaveCount(0)
  await expect(tp.getByText(/could not load this project|not found|no access/i).first()).toBeVisible({
    timeout: 15_000,
  })
  await ctx.close()

  // Quick actions: Admin and Manager see all three, one primary (New test run).
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto(`/projects/${a}`)
  await expect(page.getByRole('link', { name: 'New test run' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'New test case' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Report defect' })).toBeVisible()
  const mctx = await browser.newContext()
  const mp = await mctx.newPage()
  await loginViaUi(mp, t.tenantId, t.manager.email, t.manager.password)
  await mp.goto(`/projects/${t.projectId}`)
  for (const n of ['New test run', 'New test case', 'Report defect']) {
    await expect(mp.getByRole('link', { name: n })).toBeVisible({
      timeout: 20_000,
    })
  }
  await mctx.close()

  // A Tester who is a member sees only the actions their permissions allow.
  const tctx = await browser.newContext()
  const tm = await tctx.newPage()
  await loginViaUi(tm, t.tenantId, t.tester.email, t.tester.password)
  const perms: string[] = (await (await tm.request.get(`${API_BASE_URL}/auth/me`)).json()).data.permissions
  await tm.goto(`/projects/${t.projectId}`)
  await expect(tm.getByRole('navigation', { name: 'Project sections' })).toBeVisible()
  const wanted: [string, string][] = [
    ['New test run', 'testrun.create'],
    ['New test case', 'testcase.create'],
    ['Report defect', 'defect.create'],
  ]
  for (const [label, perm] of wanted) {
    await expect(tm.getByRole('link', { name: label })).toHaveCount(perms.includes(perm) ? 1 : 0)
  }
  // "Report defect" lands on the defect form with this project preselected.
  if (perms.includes('defect.create')) {
    await tm.getByRole('link', { name: 'Report defect' }).click()
    await expect(tm).toHaveURL(new RegExp(`/defects/new[?]projectId=${t.projectId}`))
    await expect(tm.getByRole('heading', { name: 'New Defect', level: 1 })).toBeVisible()
    await expect(tm.getByRole('combobox', { name: /^Project/ })).toContainText('Apex Motor Claims')
  }
  await tctx.close()
})
