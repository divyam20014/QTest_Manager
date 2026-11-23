import { expect, test, type Page } from '@playwright/test'

import { API_BASE_URL, bootstrapTenant, loginViaUi, nativeSelect, seedDefectBody, seedCaseBody } from './fixtures'

// BRD gap plan, Phase 2 (ADR-070): Block Case in the Execution Console, run
// auto-finish, soft delete of runs and defects, and bulk priority/assignee on
// the Test Repository. Every test runs against its own throwaway tenant.

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
  return { projectId: project.id as string, userId: me.user_id }
}

async function approvedCase(page: Page, projectId: string, title: string, steps = 2) {
  const created = await post(page, `/projects/${projectId}/test-cases`, await seedCaseBody(page.request, projectId, {
    title,
    priority: 'High',
    steps: Array.from({ length: steps }, (_, i) => ({
      action: `Do step ${i + 1} of ${title}`,
      expected: `Step ${i + 1} behaves correctly`,
    })),
  }))
  await post(page, `/test-cases/${created.id}/submit-review`, {})
  await post(page, `/test-cases/${created.id}/approve`)
  return created.id as string
}

test('Block Case: reason required, verdicts locked, unblock, and the run finishes by itself', async ({
  page,
  request,
}) => {
  const tenant = await bootstrapTenant(request, 'BrdBlock')
  await loginViaUi(page, tenant.tenantId, tenant.adminEmail, tenant.adminPassword)
  const { projectId } = await seedProject(page)
  const caseA = await approvedCase(page, projectId, 'Verify total loss settlement', 2)
  const caseB = await approvedCase(page, projectId, 'Reject a duplicate claim', 1)
  const run = await post(page, `/projects/${projectId}/test-runs`, {
    name: 'Block Flow Run',
    run_type: 'Regression',
    test_case_ids: [caseA, caseB],
  })
  const runCaseA = run.cases.find((c: { title: string }) => c.title.startsWith('Verify total loss'))
  const runCaseB = run.cases.find((c: { title: string }) => c.title.startsWith('Reject a duplicate'))

  await page.goto(`/test-run-cases/${runCaseA.id}?runId=${run.id}`)
  await expect(page.getByRole('heading', { name: 'Verify total loss settlement' })).toBeVisible()

  // The reason is mandatory.
  await page.getByRole('button', { name: 'Block', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Block this test case' })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: 'Block test case' }).click()
  await expect(dialog.getByText(/at least 3 characters/)).toBeVisible()
  await dialog.getByLabel(/Reason/).fill('Test environment is down')
  await dialog.getByRole('button', { name: 'Block test case' }).click()
  await expect(dialog).toBeHidden()

  // Blocked banner with the reason; no verdict controls; shortcuts do nothing.
  const banner = page.getByText('This test case is blocked')
  await expect(banner).toBeVisible()
  await expect(page.getByText('Test environment is down').first()).toBeVisible()
  await expect(page.getByRole('group', { name: 'Record a verdict for the current step' })).toHaveCount(0)
  await page.keyboard.press('p')
  await expect(page.getByText('0/2 steps complete')).toBeVisible()

  // The API agrees, and refuses a verdict while blocked.
  const detail = await get(page, `/test-runs/${run.id}`)
  const blockedCase = detail.cases.find((c: { id: string }) => c.id === runCaseA.id)
  expect(blockedCase.status).toBe('blocked')
  expect(blockedCase.blocked_reason).toBe('Test environment is down')
  const steps = await get(page, `/test-run-cases/${runCaseA.id}/steps`)
  const refused = await page.request.post(`${API_BASE_URL}/execution-steps/${steps[0].id}/verdict`, {
    data: { verdict: 'pass' },
  })
  expect(refused.status()).toBe(409)

  // Unblock restores the verdict controls.
  await page.getByRole('button', { name: 'Unblock' }).click()
  await expect(banner).toBeHidden()
  await expect(page.getByRole('group', { name: 'Record a verdict for the current step' })).toBeVisible()

  // Block again, then finish the other case: blocked counts as complete, so
  // the run finishes itself when the last open case is done.
  await page.getByRole('button', { name: 'Block', exact: true }).click()
  await page.getByRole('dialog', { name: 'Block this test case' }).getByLabel(/Reason/).fill('Waiting on a build')
  await page.getByRole('dialog', { name: 'Block this test case' }).getByRole('button', { name: 'Block test case' }).click()
  await expect(banner).toBeVisible()
  expect((await get(page, `/test-runs/${run.id}`)).finished_at).toBeNull()

  await page.getByRole('link', { name: 'Next case' }).first().click()
  await expect(page.getByRole('heading', { name: 'Reject a duplicate claim' })).toBeVisible()
  await page.getByRole('button', { name: /^Pass/ }).click()
  await expect(page.getByText('Every test case in this run has a result, so the run finished automatically.')).toBeVisible({
    timeout: 10000,
  })
  expect((await get(page, `/test-runs/${run.id}`)).finished_at).not.toBeNull()
  await expect(page.getByText('Run finished.')).toBeVisible()
  expect(runCaseB.id).toBeTruthy()
})

test('Delete a test run and a defect: confirmation, then gone from lists and counts', async ({
  page,
  request,
}) => {
  const tenant = await bootstrapTenant(request, 'BrdDelete')
  await loginViaUi(page, tenant.tenantId, tenant.adminEmail, tenant.adminPassword)
  const { projectId } = await seedProject(page)
  const caseId = await approvedCase(page, projectId, 'Verify total loss settlement', 1)
  const run = await post(page, `/projects/${projectId}/test-runs`, {
    name: 'Doomed Run',
    run_type: 'Smoke',
    test_case_ids: [caseId],
  })
  const defect = await post(page, '/defects', seedDefectBody(projectId, { title: 'Premium rounds the wrong way' }))

  // --- Defect ---------------------------------------------------------------
  await page.goto(`/defects/${defect.id}`)
  await page.getByRole('button', { name: 'More defect actions' }).click()
  await page.getByRole('menuitem', { name: 'Delete defect' }).click()
  let dialog = page.getByRole('alertdialog').or(page.getByRole('dialog'))
  await expect(dialog.getByText(/disappears from the defects list/)).toBeVisible()
  await dialog.getByRole('button', { name: 'Cancel' }).click()
  await expect(page).toHaveURL(new RegExp(`/defects/${defect.id}$`))
  await page.getByRole('button', { name: 'More defect actions' }).click()
  await page.getByRole('menuitem', { name: 'Delete defect' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Delete defect' }).click()
  await expect(page).toHaveURL(/\/defects$/)
  await expect(page.getByText('Premium rounds the wrong way')).toHaveCount(0)
  expect((await page.request.get(`${API_BASE_URL}/defects/${defect.id}`)).status()).toBe(404)

  // --- Test run --------------------------------------------------------------
  await page.goto(`/test-runs/${run.id}`)
  await page.getByRole('button', { name: 'Delete Run' }).click()
  dialog = page.getByRole('dialog')
  await expect(dialog.getByText(/disappears from the test runs list/)).toBeVisible()
  await dialog.getByRole('button', { name: 'Delete run' }).click()
  await expect(page).toHaveURL(new RegExp(`/projects/${projectId}/test-runs$`))
  await expect(page.getByText('Doomed Run')).toHaveCount(0)
  expect((await page.request.get(`${API_BASE_URL}/test-runs/${run.id}`)).status()).toBe(404)
})

test('Test Repository bulk priority and assignee keep approved cases approved', async ({ page, request }) => {
  const tenant = await bootstrapTenant(request, 'BrdBulk')
  await loginViaUi(page, tenant.tenantId, tenant.adminEmail, tenant.adminPassword)
  const { projectId, userId } = await seedProject(page)
  const one = await approvedCase(page, projectId, 'Verify total loss settlement', 1)
  const two = await approvedCase(page, projectId, 'Reject a duplicate claim', 1)

  await page.goto('/test-repository')
  await expect(page.getByRole('link', { name: 'Reject a duplicate claim' })).toBeVisible()
  await page.getByRole('checkbox', { name: 'Select all' }).check()
  await expect(page.getByText('2 selected', { exact: true })).toBeVisible()

  // Priority
  await page.getByRole('button', { name: 'Set priority' }).click()
  const priorityDialog = page.getByRole('dialog', { name: 'Change priority' })
  await expect(priorityDialog.getByText(/Approved cases stay approved/)).toBeVisible()
  await expect(priorityDialog.getByRole('button', { name: 'Apply' })).toBeDisabled()
  await nativeSelect(priorityDialog, /New priority/).selectOption({ index: 1 })
  const chosen = await nativeSelect(priorityDialog, /New priority/).inputValue()
  await priorityDialog.getByRole('button', { name: 'Apply' }).click()
  await expect(page.getByText('2 test cases updated.')).toBeVisible({ timeout: 10000 })

  for (const id of [one, two]) {
    const got = await get(page, `/test-cases/${id}`)
    expect(got.priority).toBe(chosen)
    expect(got.status).toBe('approved')
    expect(got.version_number).toBe(1)
  }

  // Assignee
  await page.getByRole('checkbox', { name: 'Select all' }).check()
  await page.getByRole('button', { name: 'Set assignee' }).click()
  const assigneeDialog = page.getByRole('dialog', { name: 'Change assignee' })
  await nativeSelect(assigneeDialog, /New assignee/).selectOption(userId)
  await assigneeDialog.getByRole('button', { name: 'Apply' }).click()
  await expect(page.getByText('2 test cases updated.')).toBeVisible({ timeout: 10000 })
  for (const id of [one, two]) {
    const got = await get(page, `/test-cases/${id}`)
    expect(got.assignee_id).toBe(userId)
    expect(got.status).toBe('approved')
    expect(got.version_number).toBe(1)
  }
})
