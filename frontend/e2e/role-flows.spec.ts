import { expect, test, type Page } from '@playwright/test'

import { API_BASE_URL, createTestCaseViaForm, loginViaUi, nativeSelect, seedCaseBody, reportDefectFromDialog, changeDefectStatus, seedDefectBody } from './fixtures'
import { seedRoleTenant, type RoleTenant } from './roleTenant'

// Issue 36: browser create/edit flows as a Manager and as a Tester, in a
// throwaway tenant where the Admin created both people. RBAC expectations come
// from the permission table in code (alembic 7bca6b69ef88 ROLE_PERMISSIONS plus
// app/core/policy.py), not guesses:
//   Manager: project.create/edit/delete, project.members.manage, testcase.*
//     (incl. approve), testrun.create, executionstep.record, defect.create +
//     defect.close, report.view + report.compliance_export. No user.manage /
//     audit.view.
//   Tester: testcase.create/edit, testcase.bulk_import_export, testrun.create,
//     executionstep.record, defect.create, report.view. NOT project.create,
//     testcase.approve/delete, defect.close, report.compliance_export,
//     user.manage, audit.view.

test.describe.configure({ mode: 'serial' })

let t: RoleTenant
const CASE_TITLE = 'Manager authored: verify payout'
const CASE_TITLE_EDITED = 'Manager authored: verify payout (edited)'
const PROJECT_NAME = 'Manager Created Project'
const RUN_NAME = 'Manager run: payout regression'
let managerRunId = ''
let managerRunCaseId = ''
let managerDefectId = ''

test.beforeAll(async ({ request }) => {
  t = await seedRoleTenant(request, 'RoleFlows', { withData: true })
})

async function api(page: Page, method: 'get' | 'post' | 'patch', path: string, data?: unknown) {
  const res = await page.request[method](`${API_BASE_URL}${path}`, data === undefined ? {} : { data })
  const text = await res.text()
  let body: any = null
  try {
    body = JSON.parse(text)
  } catch {
    /* non-JSON */
  }
  return { status: res.status(), data: body?.data, error: body?.error }
}

function rows(data: any): any[] {
  return Array.isArray(data) ? data : (data?.items ?? [])
}

test('Manager: creates a project, authors and edits a test case, runs it, records verdicts, raises and edits a defect', async ({
  page,
}) => {
  test.setTimeout(300_000)
  await loginViaUi(page, t.tenantId, t.manager.email, t.manager.password)

  // ---- create a project in the browser; it shows up in the list and the API.
  await page.getByRole('link', { name: 'Projects', exact: true }).first().click()
  await page.getByRole('button', { name: 'New Project' }).click()
  await page.fill('#name', PROJECT_NAME)
  await page.selectOption('#domain', 'Health')
  await page.selectOption('#priority', 'Medium')
  await page.fill('#manager_name', 'Jane Manager')
  await page.fill('#start_date', '2026-01-01')
  await page.fill('#end_date', '2026-12-31')
  await page.fill('#budget', '120000')
  await page.fill('#region', 'EMEA')
  await page.getByRole('button', { name: 'Create Project' }).click()
  await expect(page.getByRole('link', { name: PROJECT_NAME })).toBeVisible({ timeout: 15000 })
  const projects = await api(page, 'get', '/projects?page_size=100')
  expect(rows(projects.data).map((p) => p.name)).toContain(PROJECT_NAME)

  // ---- author a test case in the seeded project (Manager is a member).
  await page.goto(`/projects/${t.projectId}/test-cases`)
  await page.getByRole('button', { name: 'New Test Case' }).click()
  await createTestCaseViaForm(page, {
    title: CASE_TITLE,
    priority: 'High',
    module: 'Claims',
    steps: [
      { action: 'Open the claim', expected: 'Claim opens' },
      { action: 'Settle the claim', expected: 'Payout posted' },
    ],
  })
  await expect(page.getByRole('link', { name: CASE_TITLE })).toBeVisible({ timeout: 15000 })

  // ---- edit it (Draft: edited in place) and see the new title everywhere.
  await page.getByRole('link', { name: CASE_TITLE }).click()
  await page.waitForSelector('text=Steps')
  await page.getByRole('button', { name: 'Edit' }).click()
  await page.fill('#tc-title', CASE_TITLE_EDITED)
  await page.getByRole('button', { name: 'Save changes' }).click()
  await expect(page.getByText(CASE_TITLE_EDITED).first()).toBeVisible({ timeout: 15000 })
  const cases = await api(page, 'get', `/projects/${t.projectId}/test-cases?page_size=100`)
  expect(rows(cases.data).map((c) => c.title)).toContain(CASE_TITLE_EDITED)

  // ---- submit + approve (Manager holds testcase.approve).
  await page.getByRole('button', { name: 'Submit for Review' }).click()
  await page.locator('div[role="dialog"] button:has-text("Submit")').click()
  await expect(page.getByText('Ready for Review').first()).toBeVisible({ timeout: 15000 })
  await page.getByRole('button', { name: 'Approve' }).click()
  await expect(page.getByRole('button', { name: 'Edit' })).toBeVisible({ timeout: 15000 })

  // ---- create a run from it.
  await page.goto(`/projects/${t.projectId}/test-runs`)
  await page.getByRole('button', { name: 'New Test Run' }).click()
  await page.fill('#run-name', RUN_NAME)
  await page.click(`li label:has-text("${CASE_TITLE_EDITED}")`)
  await page.getByRole('button', { name: 'Create Test Run' }).click()
  await expect(page.getByText(RUN_NAME).first()).toBeVisible({ timeout: 15000 })
  const runs = await api(page, 'get', `/projects/${t.projectId}/test-runs?page_size=100`)
  const run = rows(runs.data).find((r) => r.name === RUN_NAME)
  expect(run, 'run exists via API').toBeTruthy()
  managerRunId = run.id
  const detail = await api(page, 'get', `/test-runs/${managerRunId}`)
  managerRunCaseId = detail.data.cases[0].id

  // ---- execute: pass step 1, fail step 2 -> defect dialog -> report.
  await page.goto(`/test-run-cases/${managerRunCaseId}?runId=${managerRunId}`)
  await page.waitForSelector('text=Execution Console')
  const bar = page.getByLabel('Record a verdict for the current step')
  await expect(bar).toContainText('Step 1:')
  await bar.getByRole('button', { name: 'Pass' }).click()
  await expect(bar).toContainText('Step 2:', { timeout: 15000 })
  await bar.getByLabel('Actual result').fill('Payout posted twice')
  await bar.getByRole('button', { name: 'Fail' }).click()
  await reportDefectFromDialog(page, { severity: 'High', description: 'Payout posted twice' })
  await expect(page.getByText('Defect reported')).toBeVisible({ timeout: 15000 })

  // Real outcomes: verdicts persisted, case rolled up to failed, defect listed.
  const steps = await api(page, 'get', `/test-run-cases/${managerRunCaseId}/steps`)
  expect(steps.data.map((s: any) => s.verdict)).toEqual(['pass', 'fail'])
  const defects = await api(page, 'get', '/defects?page_size=100')
  const mine = rows(defects.data).find((d) => (d.description ?? '').includes('Payout posted twice'))
  expect(mine, 'defect exists via API').toBeTruthy()
  await page.goto('/defects')
  await expect(page.getByRole('link', { name: /failed$/ }).first()).toBeVisible({ timeout: 15000 })

  // ---- edit the defect (priority is changed on the full edit form).
  await page.goto(`/defects/${mine.id}`)
  await page.waitForSelector('text=Traceability')
  await page.getByRole('link', { name: 'Edit', exact: true }).click()
  await nativeSelect(page, 'Priority').selectOption('Critical')
  await page.getByRole('button', { name: 'Save changes' }).click()
  await expect
    .poll(async () => (await api(page, 'get', `/defects/${mine.id}`)).data?.priority, { timeout: 15000 })
    .toBe('Critical')
  managerDefectId = mine.id
  await changeDefectStatus(page, 'Open')
  await changeDefectStatus(page, 'Fixed')
  await changeDefectStatus(page, 'Verified')
  // Manager may close a defect (defect.close), with the verification confirmation.
  await changeDefectStatus(page, 'Closed', { verify: true })
  await expect
    .poll(async () => (await api(page, 'get', `/defects/${mine.id}`)).data?.status, { timeout: 15000 })
    .toBe('Closed')
})

test('Manager: admin-only screens are blocked, project and compliance screens are open', async ({ page }) => {
  await loginViaUi(page, t.tenantId, t.manager.email, t.manager.password)
  for (const path of ['/admin/users', '/admin/roles', '/admin/audit-logs', '/settings']) {
    await page.goto(path)
    await expect(page.getByTestId('no-access'), path).toBeVisible()
  }
  await page.goto('/reporting/print')
  await expect(page.getByTestId('no-access')).toHaveCount(0)
  // Listing people is allowed (assignee pickers); managing them (user.manage) is not.
  const create = await api(page, 'post', '/users', {
    email: `nope-${Date.now()}@example.com`,
    name: 'Nope',
    role: 'tester',
    password: 'TesterPassw0rd1!',
  })
  expect(create.status).toBe(403)
  expect((await api(page, 'get', '/reports/compliance-detail')).status).toBe(200)
})

test('Tester: creates and executes a run, raises a defect, adds a comment and evidence', async ({
  page,
  browser,
}) => {
  test.setTimeout(300_000)
  await loginViaUi(page, t.tenantId, t.tester.email, t.tester.password)

  // A run on a finished run cannot be re-verdicted (by design), so the Tester
  // creates their own run (testrun.create) from the approved case.
  await page.goto(`/projects/${t.projectId}/test-runs`)
  await page.getByRole('button', { name: 'New Test Run' }).click()
  await page.fill('#run-name', 'Tester run')
  await page.click('li label:has-text("Verify settlement")')
  await page.getByRole('button', { name: 'Create Test Run' }).click()
  await expect(page.getByText('Tester run').first()).toBeVisible({ timeout: 15000 })
  const runs = await api(page, 'get', `/projects/${t.projectId}/test-runs?page_size=100`)
  const run = rows(runs.data).find((r) => r.name === 'Tester run')
  expect(run, 'tester run exists via API').toBeTruthy()
  const detail = await api(page, 'get', `/test-runs/${run.id}`)
  const runCaseId = detail.data.cases[0].id

  await page.goto(`/test-run-cases/${runCaseId}?runId=${run.id}`)
  await page.waitForSelector('text=Execution Console')
  const bar = page.getByLabel('Record a verdict for the current step')
  await expect(bar).toContainText('Step 1:')

  // ADR-059: a Tester executes only run cases explicitly assigned to them. Until a
  // Manager assigns it, the verdict is refused and the UI says why (not "try again").
  await bar.getByRole('button', { name: 'Pass' }).click()
  await expect(page.getByText(/not assigned to you/i).first()).toBeVisible({ timeout: 15000 })
  expect(
    (await api(page, 'get', `/test-run-cases/${runCaseId}/steps`)).data.map((s: any) => s.verdict),
  ).toEqual([null, null])

  // The Manager assigns the case to the Tester (another browser session).
  const mctx = await browser.newContext()
  const mpage = await mctx.newPage()
  await loginViaUi(mpage, t.tenantId, t.manager.email, t.manager.password)
  const assigned = await api(mpage, 'patch', `/test-run-cases/${runCaseId}/assign`, {
    assigned_to: t.tester.id,
  })
  expect(assigned.status).toBe(200)
  await mctx.close()
  await page.reload()
  await page.waitForSelector('text=Execution Console')
  await bar.getByRole('button', { name: 'Pass' }).click()
  await expect(bar).toContainText('Step 2:', { timeout: 15000 })
  await bar.getByLabel('Actual result').fill('Payout posted twice')
  await bar.getByRole('button', { name: 'Fail' }).click()
  await reportDefectFromDialog(page, { severity: 'Medium', description: 'Tester raised defect' })
  await expect(page.getByText('Defect reported')).toBeVisible({ timeout: 15000 })
  const steps = await api(page, 'get', `/test-run-cases/${runCaseId}/steps`)
  expect(steps.data.map((s: any) => s.verdict)).toEqual(['pass', 'fail'])
  const defects = await api(page, 'get', '/defects?page_size=100')
  expect(rows(defects.data).some((d) => (d.description ?? '').includes('Tester raised defect'))).toBe(true)

  // Comment on step 1 (collapsed card).
  await page.getByRole('button', { name: 'Comments' }).first().click()
  await page.getByLabel('New comment').first().fill('Tester note: reproduced on build 1.4')
  await page.getByRole('button', { name: 'Post' }).first().click()
  await expect(page.getByText('Tester note: reproduced on build 1.4')).toBeVisible({ timeout: 15000 })

  // Evidence: attach a file to the step.
  await page.getByRole('button', { name: 'Attachments' }).first().click()
  await page.locator('input[type="file"]').first().setInputFiles({
    name: 'evidence.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('tester evidence log'),
  })
  await expect(page.getByText('evidence.txt')).toBeVisible({ timeout: 15000 })

})

test('Tester: forbidden things are absent in the UI and refused by the API; deep links show No access', async ({
  page,
}) => {
  test.setTimeout(300_000)
  await loginViaUi(page, t.tenantId, t.tester.email, t.tester.password)

  // No "New Project" button; the API refuses project creation.
  await page.goto('/projects')
  await expect(page.getByRole('heading', { level: 1, name: 'Projects' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'New Project' })).toHaveCount(0)
  // A tester's list is already only their assigned projects: no All/My projects toggle.
  await expect(page.getByRole('group', { name: 'Which projects to show' })).toHaveCount(0)
  const create = await api(page, 'post', '/projects', {
    name: 'Tester project',
    domain: 'Motor',
    priority: 'High',
    manager_name: 'X',
    start_date: '2026-01-01',
    end_date: '2026-12-31',
    budget: '1.00',
    region: 'EMEA',
  })
  expect(create.status).toBe(403)

  // Sidebar has no administration or compliance entries.
  const links = (await page.locator('aside nav a').allTextContents()).join('|')
  for (const label of ['Users & Roles', 'Roles & Permissions', 'Audit Logs', 'Settings']) {
    expect(links).not.toContain(label)
  }

  // Deep links: admin screens and the compliance print view show No access.
  for (const path of ['/admin/users', '/admin/audit-logs', '/settings', '/reporting/print']) {
    await page.goto(path)
    await expect(page.getByTestId('no-access'), path).toBeVisible()
    await expect(page.getByTestId('no-access')).toContainText('Tester')
  }

  // Reporting page: no compliance export controls.
  await page.goto('/reporting')
  await expect(page.getByRole('heading', { level: 1, name: 'Reports' }).or(page.locator('h1')).first()).toBeVisible()
  await expect(page.getByRole('button', { name: 'Export', exact: true })).toHaveCount(0)

  // API: user management, compliance export, approve and close are all 403.
  expect((await api(page, 'get', '/users')).status).toBe(403)
  expect((await api(page, 'get', '/audit-logs')).status).toBe(403)
  const complianceRes = await page.request.get(`${API_BASE_URL}/reports/compliance-detail`)
  expect(complianceRes.status()).toBe(403)
  expect((await api(page, 'post', `/test-cases/${t.caseId}/approve`)).status).toBe(403)

  // A Ready-for-Review case shows no Approve button to a Tester.
  const draft = await api(page, 'post', `/projects/${t.projectId}/test-cases`, {
    ...(await seedCaseBody(page.request, t.projectId!, { priority: 'Low' })),
    title: 'Tester draft case',
  })
  expect(draft.status).toBeLessThan(300)
  await api(page, 'post', `/test-cases/${draft.data.id}/submit-review`, {})
  await page.goto(`/test-cases/${draft.data.id}`)
  await expect(page.getByText('Ready for Review').first()).toBeVisible({ timeout: 15000 })
  await expect(page.getByRole('button', { name: 'Approve' })).toHaveCount(0)

  // A Tester can walk a defect to Verified but is refused the Closed step (defect.close).
  const own = await api(
    page,
    'post',
    '/defects',
    seedDefectBody(undefined, {
      execution_step_id: (await api(page, 'get', `/test-run-cases/${t.runCaseId}/steps`)).data[0].id,
      severity: 'Low',
      description: 'Tester defect to close',
    }),
  )
  expect(own.status).toBeLessThan(300)
  for (const status of ['Open', 'Fixed', 'Verified']) {
    const step = await api(page, 'patch', `/defects/${own.data.id}/status`, { status })
    expect(step.status, status).toBe(200)
  }
  const close = await api(page, 'patch', `/defects/${own.data.id}/status`, {
    status: 'Closed',
    verification_confirmed: true,
  })
  expect(close.status).toBe(403)
  expect(managerDefectId).not.toBe('')
})
