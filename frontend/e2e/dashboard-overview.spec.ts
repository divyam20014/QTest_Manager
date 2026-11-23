import { expect, test, type Page, type Route } from '@playwright/test'

import { bootstrapTenant, loginViaUi } from './fixtures'

// ADR-110: Overview dashboard redesign -- four KPI cards (whole card = link, with a
// previous-period trend), trend range control, honest empty state, Customize button.

async function fulfillCors(route: Route, status: number, json: unknown) {
  const req = route.request()
  const headers: Record<string, string> = {
    'access-control-allow-origin': req.headers()['origin'] ?? '*',
    'access-control-allow-credentials': 'true',
    'access-control-allow-headers': req.headers()['access-control-request-headers'] ?? '*',
    'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
  }
  if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers })
  return route.fulfill({ status, headers, json: { data: json, error: null } })
}

async function signIn(page: Page, request: Parameters<typeof bootstrapTenant>[0]) {
  const tenant = await bootstrapTenant(request, 'DashOv')
  await loginViaUi(page, tenant.tenantId, tenant.adminEmail, tenant.adminPassword)
}

test('empty tenant: short empty state with a Start a test run action, no big n/a', async ({ page, request }) => {
  await signIn(page, request)
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible()
  await expect(page.getByText('No execution activity yet')).toBeVisible()
  await expect(page.getByRole('link', { name: 'Start a test run' })).toBeVisible()
  await expect(page.getByText('n/a', { exact: true })).toHaveCount(0)
  await expect(page.getByText('Nothing needs attention')).toBeVisible()
  await expect(page.getByTestId('kpi-card')).toHaveCount(4)
})

test('each KPI card is one link to its list', async ({ page, request }) => {
  await signIn(page, request)
  await page.setViewportSize({ width: 1280, height: 900 })
  const targets: [RegExp, RegExp][] = [
    [/^Active runs:/, /\/test-runs\?status=in_progress$/],
    [/^Open defects:/, /\/defects\?status=/],
    [/^Test cases:/, /\/test-repository$/],
    [/^Pass rate:/, /\/reporting$/],
  ]
  for (const [name, url] of targets) {
    await page.goto('/')
    await page.getByRole('link', { name }).click()
    await expect(page).toHaveURL(url)
  }
})

test('trend is shown against the previous period, and only when there is a baseline', async ({ page, request }) => {
  await signIn(page, request)
  await page.route('**/api/v1/dashboard/summary**', (route) =>
    fulfillCors(route, 200, {
      projects: { total: 1, active: 1, by_status: { 'On Track': 1 } },
      test_cases: { total: 12, approved_count: 6, approved_ratio: 0.5 },
      test_runs: { active: 3, step_pass_percentage: 0.8, step_sample_size: 40 },
      defects: { open_by_severity: { High: 5 }, critical_count: 0 },
      previous: {
        days: 30,
        test_cases_total: 10,
        active_runs: 0,
        open_defects: 10,
        step_pass_percentage: 0.7,
        step_sample_size: 20,
      },
    }),
  )
  await page.goto('/')
  await expect(page.getByRole('link', { name: 'Open defects: 5. down 50% vs 30d ago' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Test cases: 12. up 20% vs 30d ago' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Pass rate: 80%. up 10.0 pts vs 30d ago' })).toBeVisible()
  // A zero baseline gives no trend rather than an invented one.
  await expect(page.getByRole('link', { name: 'Active runs: 3. No trend yet' })).toBeVisible()
})

test('trend range control re-queries and Customize reaches the manage page', async ({ page, request }) => {
  await signIn(page, request)
  const days: string[] = []
  await page.route('**/api/v1/reports/execution-trend**', (route) => {
    days.push(new URL(route.request().url()).searchParams.get('days') ?? '')
    return fulfillCors(route, 200, {
      points: [
        { date: '2026-11-01', pass_count: 4, fail_count: 1, ignore_count: 0 },
        { date: '2026-11-02', pass_count: 6, fail_count: 2, ignore_count: 0 },
      ],
    })
  })
  await page.goto('/')
  await expect(page.getByRole('button', { name: '30d' })).toHaveAttribute('aria-pressed', 'true')
  await page.getByRole('button', { name: '7d' }).click()
  await expect(page.getByRole('button', { name: '7d' })).toHaveAttribute('aria-pressed', 'true')
  await expect.poll(() => days.includes('7')).toBe(true)

  await page.getByRole('link', { name: 'Customize' }).click()
  await expect(page).toHaveURL(/\/dashboards$/)
  await expect(page.getByRole('heading', { name: 'Manage dashboards', level: 1 })).toBeVisible()
})
