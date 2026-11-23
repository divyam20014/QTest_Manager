import { expect, test } from '@playwright/test'

import { bootstrapTenant, loginViaUi } from './fixtures'

// UI/UX remediation Phase D: Dashboard. Four KPI cards (each one link, ADR-110),
// chart panels with a table alternative and a trend range control, charts that
// follow the app's light/dark toggle, and honest empty / error states.

// Mocked API replies are cross-origin (page :5173, API :8000), so they need the
// same CORS headers the real API sends, including for the preflight.
async function fulfillCors(route: import('@playwright/test').Route, status: number, json: unknown) {
  const req = route.request()
  const headers: Record<string, string> = {
    'access-control-allow-origin': req.headers()['origin'] ?? '*',
    'access-control-allow-credentials': 'true',
    'access-control-allow-headers': req.headers()['access-control-request-headers'] ?? '*',
    'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
  }
  if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers })
  // The API wraps every reply in { data, error }.
  return route.fulfill({ status, headers, json: status >= 400 ? { data: null, error: json } : { data: json, error: null } })
}

const overflowOf = (page: import('@playwright/test').Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)

test('empty tenant: honest empty states, working tile links, no overflow', async ({ page, request }) => {
  const tenant = await bootstrapTenant(request, 'DashD')
  await loginViaUi(page, tenant.tenantId, tenant.adminEmail, tenant.adminPassword)

  for (const width of [1280, 768, 390]) {
    await page.setViewportSize({ width, height: 900 })
    await page.goto('/')
    await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible()
    await expect(page.getByRole('link', { name: /^Pass rate:/ })).toBeVisible()
    await expect(page.getByText('No test cases yet')).toBeVisible()
    await expect(page.getByText('No execution activity yet')).toBeVisible()
    await expect(page.getByText('Nothing needs attention')).toBeVisible()
    // No chart can be viewed as a table when there is nothing to tabulate.
    await expect(page.getByRole('button', { name: 'View as table' })).toHaveCount(0)
    expect(await overflowOf(page), `overflow at ${width}px`).toBeLessThanOrEqual(0)
  }

  // The whole KPI card is one link; it has to be keyboard-operable.
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto('/')
  await page.getByRole('link', { name: /^Test cases:/ }).click()
  await expect(page).toHaveURL(/\/test-repository$/)
  await page.goto('/')
  await page.getByRole('link', { name: /^Open defects:/ }).focus()
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/\/defects\?status=/)
})

test('a failed summary shows an error state and recovers on retry', async ({ page, request }) => {
  const tenant = await bootstrapTenant(request, 'DashD')
  await loginViaUi(page, tenant.tenantId, tenant.adminEmail, tenant.adminPassword)
  await page.route('**/api/v1/dashboard/summary', (route) => fulfillCors(route, 500, { code: 'internal_error', message: 'boom' }))
  await page.goto('/')
  await expect(page.getByText("Couldn't load this").first()).toBeVisible({ timeout: 15000 })
  await page.unroute('**/api/v1/dashboard/summary')
  await page.getByRole('button', { name: 'Try again' }).first().click()
  await expect(page.getByRole('link', { name: /^Pass rate:/ })).toBeVisible()
})

test('charts: table view, trend range, and colours follow the app theme toggle', async ({ page, request }) => {
  const tenant = await bootstrapTenant(request, 'DashD')
  await loginViaUi(page, tenant.tenantId, tenant.adminEmail, tenant.adminPassword)

  const points = Array.from({ length: 7 }, (_, i) => ({
    date: `2026-11-0${i + 1}`,
    pass_count: 10 + i,
    fail_count: i,
    ignore_count: 0,
  }))
  const requested: string[] = []
  await page.route('**/api/v1/reports/execution-trend**', (route) => {
    requested.push(new URL(route.request().url()).searchParams.get('days') ?? '')
    return fulfillCors(route, 200, { points })
  })
  await page.route('**/api/v1/reports/aggregate**', (route) =>
    fulfillCors(route, 200, {
      metric: 'test_case_status',
      group_by: 'project',
      rows: [
        { group_key: 'a', group_label: 'P', value: 'draft', count: 3 },
        { group_key: 'a', group_label: 'P', value: 'approved', count: 9 },
      ],
    }),
  )

  // The in-app toggle says dark while the OS says light: charts must use the dark palette.
  await page.addInitScript(() => localStorage.setItem('qtesthub:theme', 'dark'))
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Execution trend' })).toBeVisible()
  await expect(page.locator('path.recharts-line-curve').first()).toBeVisible()
  const stroke = await page.locator('path.recharts-line-curve').first().getAttribute('stroke')
  expect(stroke?.toLowerCase()).toBe('#199e70') // dark categorical slot 3, not the light #1baf7a

  // Direct values beside the legend.
  await expect(page.getByText('Draft', { exact: true })).toBeVisible()
  await expect(page.getByText('3 · 25%')).toBeVisible()

  // Trend range control re-queries with the chosen window.
  await page.getByRole('button', { name: '7d' }).click()
  await expect.poll(() => requested.includes('7')).toBe(true)
  await expect(page.getByRole('button', { name: '7d' })).toHaveAttribute('aria-pressed', 'true')

  // Table alternative for the trend chart.
  await page.getByRole('button', { name: 'View as table' }).first().click()
  const table = page.getByRole('table').filter({ hasText: 'Fail' })
  await expect(table).toBeVisible()
  await expect(table.getByRole('row')).toHaveCount(points.length + 1)
  await page.getByRole('button', { name: 'View as chart' }).click()
  await expect(page.locator('path.recharts-line-curve').first()).toBeVisible()
})
