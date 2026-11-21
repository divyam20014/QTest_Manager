import { expect, test, type Page, type Route } from '@playwright/test'
import { readFileSync } from 'node:fs'

import { API_BASE_URL, bootstrapTenant, loginViaUi } from './fixtures'

// BRD gap plan, Phase 3 (ADR-071): Excel exports with loading/error handling,
// the project drilldown, and the Quality Metrics card. Each test runs against
// its own throwaway tenant.

async function post(page: Page, path: string, data?: unknown) {
  const response = await page.request.post(`${API_BASE_URL}${path}`, { data })
  if (!response.ok()) throw new Error(`POST ${path} failed (${response.status()}): ${await response.text()}`)
  return (await response.json()).data
}

async function get(page: Page, path: string) {
  const response = await page.request.get(`${API_BASE_URL}${path}`)
  if (!response.ok()) throw new Error(`GET ${path} failed (${response.status()}): ${await response.text()}`)
  return (await response.json()).data
}

async function seedProject(page: Page, name = 'Apex Motor Claims') {
  const me = (await get(page, '/auth/me')) as { user_id: string }
  const project = await post(page, '/projects', {
    name,
    domain: 'Motor',
    priority: 'High',
    manager_name: 'Jane Manager',
    start_date: '2026-01-01',
    end_date: '2026-12-31',
    budget: '450000.00',
    region: 'North America',
  })
  if (!project.assigned_user_ids.includes(me.user_id)) {
    await post(page, `/projects/${project.id}/members`, { user_id: me.user_id })
  }
  return project.id as string
}

async function approvedCase(page: Page, projectId: string, title: string) {
  const created = await post(page, `/projects/${projectId}/test-cases`, {
    title,
    priority: 'High',
    steps: [
      { action: `Do step 1 of ${title}`, expected: 'Works' },
      { action: `Do step 2 of ${title}`, expected: 'Works' },
    ],
  })
  await post(page, `/test-cases/${created.id}/submit-review`, {})
  await post(page, `/test-cases/${created.id}/approve`)
  return created.id as string
}

async function passRun(page: Page, projectId: string, caseIds: string[]) {
  const run = await post(page, `/projects/${projectId}/test-runs`, {
    name: 'Phase 3 Run',
    run_type: 'Regression',
    test_case_ids: caseIds,
  })
  for (const runCase of run.cases) {
    const steps = await get(page, `/test-run-cases/${runCase.id}/steps`)
    for (const step of steps) {
      await post(page, `/execution-steps/${step.id}/verdict`, { verdict: 'pass' })
    }
  }
  return run.id as string
}

test('Project drilldown shows run status chart, recent test cases and defects', async ({ page, request }) => {
  const tenant = await bootstrapTenant(request, 'BrdDrill')
  await loginViaUi(page, tenant.tenantId, tenant.adminEmail, tenant.adminPassword)
  const projectId = await seedProject(page)

  // Empty project first: honest empty states, no chart.
  await page.goto(`/projects/${projectId}/details`)
  await expect(page.getByRole('heading', { name: 'Test run status' })).toBeVisible()
  await expect(page.getByText('No test runs yet')).toBeVisible()
  await expect(page.getByText('No test cases yet')).toBeVisible()
  await expect(page.getByText('No defects yet')).toBeVisible()

  const caseId = await approvedCase(page, projectId, 'Verify total loss settlement')
  await passRun(page, projectId, [caseId])
  await post(page, '/defects', { project_id: projectId, title: 'Payout rounds incorrectly', severity: 'High' })

  await page.reload()
  const chart = page.getByRole('heading', { name: 'Test run status' })
  await expect(chart).toBeVisible()
  await expect(page.getByText('No test runs yet')).toHaveCount(0)
  // Legend carries the values (not colour-only).
  const legend = page.locator('ul').filter({ hasText: 'Passed' }).first()
  await expect(legend).toContainText('Passed')
  await expect(legend).toContainText('1')

  // Table alternative.
  await page.getByRole('button', { name: 'View as table' }).first().click()
  const statusTable = page.getByRole('table', { name: 'Test run status' })
  await expect(statusTable).toBeVisible()
  await expect(statusTable.getByRole('row', { name: /Passed\s+1/ })).toBeVisible()

  // Recent lists link to the real records.
  await page.getByRole('link', { name: 'Verify total loss settlement' }).first().click()
  await expect(page).toHaveURL(/\/test-cases\//)
  await page.goBack()
  await page.getByRole('link', { name: 'Payout rounds incorrectly' }).click()
  await expect(page).toHaveURL(/\/defects\//)
})

test('Quality Metrics card: honest "no data" first, real figures after a run', async ({ page, request }) => {
  const tenant = await bootstrapTenant(request, 'BrdQuality')
  await loginViaUi(page, tenant.tenantId, tenant.adminEmail, tenant.adminPassword)
  const projectId = await seedProject(page)

  await page.goto('/reporting')
  const card = page.locator('section, div').filter({ has: page.getByRole('heading', { name: 'Quality Metrics' }) }).last()
  await expect(page.getByRole('heading', { name: 'Quality Metrics' })).toBeVisible()
  // Nothing measured yet: never a fabricated 0%.
  await expect(page.getByText('No data yet').first()).toBeVisible()
  await expect(page.getByText('There are no test cases yet')).toBeVisible()
  void card

  const caseId = await approvedCase(page, projectId, 'Verify total loss settlement')
  await passRun(page, projectId, [caseId])

  await page.reload()
  await expect(page.getByText('1 of 1 test cases are Approved')).toBeVisible()
  const gate = page.locator('dt', { hasText: 'Review-gate coverage' }).locator('xpath=following-sibling::dd[1]')
  await expect(gate).toHaveText('100%')
  const pass = page.locator('dt', { hasText: 'Step pass rate' }).locator('xpath=following-sibling::dd[1]')
  await expect(pass).toHaveText('100%')
  await expect(page.getByText('Across 1 finished run')).toBeVisible()

  // Period control re-queries.
  const requested = page.waitForRequest((r) => r.url().includes('/reports/quality-metrics?') && r.url().includes('days=90'))
  await page.getByRole('button', { name: '90d' }).click()
  await requested
})

test('Excel exports download real workbooks and report failures', async ({ page, request }) => {
  const tenant = await bootstrapTenant(request, 'BrdExcel')
  await loginViaUi(page, tenant.tenantId, tenant.adminEmail, tenant.adminPassword)
  const projectId = await seedProject(page)
  const caseId = await approvedCase(page, projectId, 'Verify total loss settlement')
  await passRun(page, projectId, [caseId])

  // Reports: aggregate workbook for the selected metric.
  await page.goto('/reporting')
  const exportAggregate = page.getByRole('button', { name: 'Export Excel (aggregate report)' })
  await expect(exportAggregate).toBeEnabled()
  const [download] = await Promise.all([page.waitForEvent('download'), exportAggregate.click()])
  expect(download.suggestedFilename()).toMatch(/^report_.*\.xlsx$/)
  const path = await download.path()
  const bytes = readFileSync(path)
  expect(bytes.subarray(0, 2).toString('latin1')).toBe('PK') // xlsx is a zip
  await expect(page.getByText('Export downloaded')).toBeVisible()

  // Compliance workbook.
  const [compliance] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Download Compliance Excel' }).click(),
  ])
  expect(compliance.suggestedFilename()).toBe('compliance_summary.xlsx')

  // Test cases list.
  await page.goto(`/projects/${projectId}/test-cases`)
  const [cases] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Export Excel (test cases)' }).click(),
  ])
  expect(cases.suggestedFilename()).toBe('test_cases_export.xlsx')

  // A failing export is reported, not a browser error page.
  await page.route('**/reports/quality-metrics/export.xlsx**', async (route: Route) => {
    const req = route.request()
    await route.fulfill({
      status: 500,
      headers: {
        'access-control-allow-origin': req.headers()['origin'] ?? '*',
        'access-control-allow-credentials': 'true',
      },
      json: { data: null, error: { code: 'server_error', message: 'boom' } },
    })
  })
  await page.goto('/reporting')
  await page.getByRole('button', { name: 'Export Excel (quality metrics)' }).click()
  await expect(page.getByText('Could not create the export. Please try again.')).toBeVisible()
  await expect(page).toHaveURL(/\/reporting/)
})

test('Tester: no compliance Excel button, and cannot fetch it', async ({ page, browser, request }) => {
  const tenant = await bootstrapTenant(request, 'BrdTesterX')
  await loginViaUi(page, tenant.tenantId, tenant.adminEmail, tenant.adminPassword)
  const suffix = tenant.tenantId.slice(0, 8)
  const email = `tester-${suffix}@example.com`
  const password = 'TesterPassw0rd1!'
  await post(page, '/users', { email, name: 'Tester E2E', role: 'tester', password })

  const ctx = await browser.newContext()
  const testerPage = await ctx.newPage()
  await loginViaUi(testerPage, tenant.tenantId, email, password)
  await testerPage.goto('/reporting')
  await expect(testerPage.getByRole('heading', { name: 'Reporting' })).toBeVisible()
  await expect(testerPage.getByRole('button', { name: 'Download Compliance Excel' })).toHaveCount(0)
  const denied = await testerPage.request.get(`${API_BASE_URL}/reports/compliance-export.xlsx`)
  expect(denied.status()).toBe(403)
  await ctx.close()
})
