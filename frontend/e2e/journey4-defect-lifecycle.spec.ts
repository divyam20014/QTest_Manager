import { expect, test } from '@playwright/test'

import { API_BASE_URL, bootstrapTenant, loginViaUi } from './fixtures'

// BRD Journey 4: after a fix, re-verdicting a previously-failed step to
// Pass flips the case rollup back to Passed (not just logged in a backend
// test -- watched happen on screen), and a defect is walked through its
// full lifecycle to Closed.
test('Re-verdicting a failed step to Pass flips the case back to Passed, and the defect can be closed', async ({
  page,
  request,
}) => {
  const tenant = await bootstrapTenant(request, 'J4Lifecycle')
  await loginViaUi(page, tenant.tenantId, tenant.adminEmail, tenant.adminPassword)

  await page.click('a:has-text("Projects")')
  await page.click('button:has-text("New Project")')
  await page.waitForSelector('text=New Project')
  await page.fill('#name', 'Apex Motor Claims Modernization')
  await page.selectOption('#domain', 'Motor')
  await page.selectOption('#priority', 'High')
  await page.fill('#manager_name', 'Jane Manager')
  await page.fill('#start_date', '2026-01-01')
  await page.fill('#end_date', '2026-12-31')
  await page.fill('#budget', '450000')
  await page.fill('#region', 'North America')
  await page.click('button:has-text("Create Project")')
  await page.click('a:has-text("Apex Motor Claims Modernization")')
  await page.waitForSelector('text=Team Members')

  await page.click('a:has-text("Test Cases")')
  await page.click('button:has-text("New Test Case")')
  await page.waitForSelector('text=New Test Case')
  await page.fill('#title', 'Verify Total Loss Settlement Calculation')
  await page.selectOption('#priority', 'Critical')
  const actions = await page.$$('input[placeholder="Action"]')
  const expecteds = await page.$$('input[placeholder="Expected outcome"]')
  await actions[0].fill('Input Policy Number')
  await expecteds[0].fill('ACV displayed')
  await page.click('button:has-text("Create Test Case")')
  await expect(page.getByRole('link', { name: 'Verify Total Loss Settlement Calculation' })).toBeVisible({
    timeout: 10000,
  })
  await page.click('a:has-text("Verify Total Loss Settlement Calculation")')
  await page.waitForSelector('text=Steps')
  await page.click('button:has-text("Submit for Review")')
  await expect(page.getByText('Ready for Review')).toBeVisible({ timeout: 10000 })
  await page.click('button:has-text("Approve")')
  await expect(page.getByRole('button', { name: 'Edit' })).toBeVisible({ timeout: 10000 })

  await page.click('a:has-text("← Test Cases")')
  await page.waitForSelector('text=Verify Total Loss Settlement Calculation', { timeout: 10000 })
  await page.click('a:has-text("← Apex Motor Claims Modernization")')
  await page.waitForSelector('text=Team Members', { timeout: 10000 })
  await page.click('a:has-text("Test Runs")')
  await page.click('button:has-text("New Test Run")')
  await page.waitForSelector('text=New Test Run')
  await page.fill('#run-name', 'Sprint 42 Motor Regression Cycle')
  await page.click('li label:has-text("Verify Total Loss Settlement Calculation")')
  await page.click('button:has-text("Create Test Run")')
  await expect(page.getByRole('link', { name: 'Execute' })).toBeVisible({ timeout: 10000 })
  await page.click('a:has-text("Execute")')
  await page.waitForSelector('text=Execution Console', { timeout: 10000 })

  await page.click('button:has-text("Fail")')
  await expect(page.getByRole('heading', { name: 'Report Defect' })).toBeVisible({ timeout: 10000 })
  await page.selectOption('#defect-severity', 'Critical')
  await page.click('button:has-text("Report Defect")')
  await expect(page.getByText('Defect reported')).toBeVisible({ timeout: 10000 })

  // Journey 4: the fix is applied, the Tester re-runs the same step and
  // marks it Pass -- the case rollup must flip from Failed back to Passed.
  await page.click('text=Re-run step')
  await page.click('.mt-3 button:has-text("Pass")')
  await page.waitForTimeout(500)
  await page.goBack()
  await expect(page.getByText('passed')).toBeVisible({ timeout: 10000 })

  // Walk the reported defect to Closed via the Defects screen.
  await page.click('a:has-text("Defects")')
  await page.waitForSelector('text=Step 1 Failed', { timeout: 10000 })
  await page.click('a:has-text("Step 1 Failed")')
  await page.waitForSelector('text=Traceability', { timeout: 10000 })
  await page.click('button:has-text("Advance to Open")')
  await page.waitForSelector('button:has-text("Advance to Fixed")', { timeout: 10000 })
  await page.click('button:has-text("Advance to Fixed")')
  await page.waitForSelector('button:has-text("Advance to Verified")', { timeout: 10000 })
  await page.click('button:has-text("Advance to Verified")')
  await page.waitForSelector('button:has-text("Advance to Closed")', { timeout: 10000 })
  await page.click('button:has-text("Advance to Closed")')

  // Don't trust a screenshot/DOM text race for the final state -- confirm
  // the actual persisted status via a direct API call (same pattern used
  // in the Phase 10.6 manual verification).
  await page.waitForTimeout(500)
  const currentUrl = page.url()
  const defectId = currentUrl.split('/defects/')[1]
  const response = await request.get(`${API_BASE_URL}/defects/${defectId}`, {
    headers: { cookie: (await page.context().cookies()).map((c) => `${c.name}=${c.value}`).join('; ') },
  })
  const body = await response.json()
  expect(body.data.status).toBe('Closed')
  expect(body.data.closed_at).not.toBeNull()
})

test('Tester cannot close a defect', async ({ page, request }) => {
  const tenant = await bootstrapTenant(request, 'J4TesterGate')

  // Create a Tester via the API as the bootstrap Admin (faster and more
  // reliable than driving the Administration UI just to set up this test's
  // fixture data -- the Admin-driven user-creation UI path is already
  // covered end-to-end by Phase 10.8's Administration coverage). Playwright's
  // `request` fixture keeps its own cookie jar across calls automatically,
  // so the session cookie from login carries through every call below.
  const loginRes = await request.post(`${API_BASE_URL}/auth/login`, {
    data: { tenant_id: tenant.tenantId, email: tenant.adminEmail, password: tenant.adminPassword },
  })
  const code = (await loginRes.json()).data.debug_code
  await request.post(`${API_BASE_URL}/auth/mfa/verify`, { data: { code } })

  await request.post(`${API_BASE_URL}/users`, {
    data: { email: 'tester@example.com', name: 'Tester One', role: 'tester', password: 'TesterPassw0rd1!' },
  })
  const usersList = (await (await request.get(`${API_BASE_URL}/users`)).json()).data
  const testerId = usersList.find((u: { email: string; id: string }) => u.email === 'tester@example.com').id

  const project = (
    await (
      await request.post(`${API_BASE_URL}/projects`, {
        data: {
          name: 'Apex Motor Claims',
          domain: 'Motor',
          priority: 'High',
          manager_name: 'Jane Manager',
          start_date: '2026-01-01',
          end_date: '2026-12-31',
          budget: '450000.00',
          region: 'North America',
        },
      })
    ).json()
  ).data
  await request.post(`${API_BASE_URL}/projects/${project.id}/members`, { data: { user_id: testerId } })

  const testCase = (
    await (
      await request.post(`${API_BASE_URL}/projects/${project.id}/test-cases`, {
        data: { title: 'Verify Settlement', priority: 'High', steps: [{ action: 'Do X', expected: 'Y' }] },
      })
    ).json()
  ).data
  await request.post(`${API_BASE_URL}/test-cases/${testCase.id}/submit-review`)
  await request.post(`${API_BASE_URL}/test-cases/${testCase.id}/approve`)

  const run = (
    await (
      await request.post(`${API_BASE_URL}/projects/${project.id}/test-runs`, {
        data: { name: 'Sprint Run', run_type: 'Smoke', test_case_ids: [testCase.id] },
      })
    ).json()
  ).data
  const runCaseId = run.cases[0].id
  const steps = (await (await request.get(`${API_BASE_URL}/test-run-cases/${runCaseId}/steps`)).json()).data
  await request.post(`${API_BASE_URL}/execution-steps/${steps[0].id}/verdict`, { data: { verdict: 'fail' } })
  const defect = (
    await (
      await request.post(`${API_BASE_URL}/defects`, {
        data: { execution_step_id: steps[0].id, severity: 'High' },
      })
    ).json()
  ).data

  await request.post(`${API_BASE_URL}/auth/logout`)

  await loginViaUi(page, tenant.tenantId, 'tester@example.com', 'TesterPassw0rd1!')
  await page.goto(`/defects/${defect.id}`)
  await page.waitForSelector('text=Traceability', { timeout: 10000 })
  await page.click('button:has-text("Advance to Open")')
  await page.waitForSelector('button:has-text("Advance to Fixed")', { timeout: 10000 })
  await page.click('button:has-text("Advance to Fixed")')
  await page.waitForSelector('button:has-text("Advance to Verified")', { timeout: 10000 })
  await page.click('button:has-text("Advance to Verified")')

  // The transition to Closed is Manager/Admin-only (ADR-026): the Tester
  // must not be offered a working control for it.
  await expect(page.getByRole('button', { name: 'Advance to Closed' })).toBeDisabled({ timeout: 10000 })
})
