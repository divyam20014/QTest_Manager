import { expect, test, type Page } from '@playwright/test'

import { API_BASE_URL, changeDefectStatus, loginViaUi, nativeSelect, reportDefectFromDialog, seedCaseBody, seedDefectBody } from './fixtures'
import { seedRoleTenant, type RoleTenant } from './roleTenant'

// ADR-119: the Defect UI on the 22-field standard -- the six-section form with inline validation,
// editing after creation, assignment, the status workflow with its resolution rules, linking test
// cases in both directions, defects raised from a failed step, the retest workflow, the list's column
// modes and saved views, and the export menu.

test.describe.configure({ mode: 'serial' })

let t: RoleTenant
let secondCaseId = ''
let secondCaseDisplayId = ''
let caseDisplayId = ''
let createdDefectId = ''
let createdBugId = ''

const TITLE = 'Checkout total ignores the discount code'

async function api(page: Page, method: 'get' | 'post' | 'patch' | 'delete', path: string, data?: unknown) {
  const res = await page.request[method](`${API_BASE_URL}${path}`, data === undefined ? undefined : { data })
  const body = await res.json().catch(() => ({}))
  return { status: res.status(), data: body.data as any, error: body.error }
}

test.beforeAll(async ({ request }) => {
  test.setTimeout(240_000)
  t = await seedRoleTenant(request, 'dfstd', { withData: true })
})

async function signIn(page: Page, who: 'admin' | 'manager' | 'tester' = 'admin') {
  if (who === 'admin') await loginViaUi(page, t.tenantId, t.adminEmail, t.adminPassword)
  else await loginViaUi(page, t.tenantId, t[who].email, t[who].password)
}

/** Fills the environment whether the tenant has environments to pick from or not. */
async function fillEnvironment(page: Page, value: string) {
  const typed = page.locator('input#df-environment')
  if ((await typed.count()) > 0) {
    await typed.fill(value)
    return
  }
  await page.locator('select#df-environment').selectOption('__other')
  await page.locator('#df-environment-text').fill(value)
}

test('create: six sections, inline validation, every mandatory field, labels, a linked test case', async ({ page }) => {
  test.setTimeout(180_000)
  await page.setViewportSize({ width: 1440, height: 900 })
  await signIn(page)
  // The second case is linked later; the first one is linked while creating.
  const first = await api(page, 'get', `/test-cases/${t.caseId}`)
  caseDisplayId = first.data.display_id
  const second = await api(page, 'post', `/projects/${t.projectId}/test-cases`, await seedCaseBody(page.request, t.projectId!, { title: 'Second linked case' }))
  expect(second.status).toBeLessThan(300)
  secondCaseId = second.data.id
  secondCaseDisplayId = second.data.display_id

  await page.goto(`/defects?projectId=${t.projectId}`)
  await page.getByRole('button', { name: 'New Defect' }).click()
  await expect(page).toHaveURL(/\/defects\/new\?projectId=/)
  await expect(page.getByRole('heading', { name: 'New Defect', level: 1 })).toBeVisible()
  for (const name of ['Bug Overview', 'Reproduction Details', 'Environment & Evidence', 'Classification', 'Ownership & Tracking', 'Traceability']) {
    await expect(page.getByRole('button', { name: new RegExp(name) })).toBeVisible()
  }
  // Bug ID and the automatic fields are read-only.
  await expect(page.locator('#df-display-id')).toHaveAttribute('readonly', '')
  await expect(page.locator('#df-reporter')).toHaveAttribute('readonly', '')
  await expect(page.locator('#df-date')).toHaveAttribute('readonly', '')

  // Validation on blur, inline and linked to the field.
  await page.fill('#df-title', 'abc')
  await page.locator('#df-title').blur()
  await expect(page.locator('#df-title-error')).toContainText('at least 5')
  await expect(page.locator('#df-title')).toHaveAttribute('aria-invalid', 'true')

  // Saving the empty form names every missing field and keeps what was typed.
  await page.getByRole('button', { name: 'Create defect' }).click()
  await expect(page.getByText('Description is required').first()).toBeVisible()
  await expect(page.getByText('Add at least one step to reproduce').first()).toBeVisible()
  await expect(page.getByText('Expected result is required').first()).toBeVisible()
  await expect(page.getByText('Actual result is required').first()).toBeVisible()
  await expect(page.getByText('Environment is required').first()).toBeVisible()
  await expect(page.getByText('Severity is required').first()).toBeVisible()
  await expect(page.getByText(/to fix/).first()).toBeVisible()
  await expect(page.locator('#df-title')).toHaveValue('abc')

  // Fill it in.
  await page.fill('#df-title', TITLE)
  await page.fill('#df-description', 'Applying a valid discount code leaves the order total unchanged.')
  await page.locator('[data-field="action"]').first().fill('Add an item to the basket and open checkout')
  await page.getByRole('button', { name: 'Add step' }).click()
  await page.locator('[data-field="action"]').nth(1).fill('Apply the code SAVE10')
  await page.fill('#df-expected', 'The total drops by 10 percent')
  await page.fill('#df-actual', 'The total is unchanged')
  await fillEnvironment(page, 'Staging, Chrome 130')
  await nativeSelect(page, 'Severity').selectOption('High')
  // Labels: Enter or the Add button; lower-cased; a duplicate is refused.
  await page.fill('#df-labels', 'Regression')
  await page.keyboard.press('Enter')
  await page.fill('#df-labels', 'checkout')
  await page.getByRole('button', { name: 'Add', exact: true }).click()
  await page.fill('#df-labels', 'REGRESSION')
  await page.keyboard.press('Enter')
  await expect(page.locator('#df-labels-error')).toContainText('already added')
  await expect(page.getByRole('list', { name: 'Labels / Tags added' }).getByRole('listitem')).toHaveCount(2)
  await expect(page.getByRole('button', { name: 'Remove label regression' })).toBeVisible()
  await page.fill('#df-labels', '')
  // A label over 40 characters is refused with the limit named.
  await page.fill('#df-labels', 'x'.repeat(41))
  await page.keyboard.press('Enter')
  await expect(page.locator('#df-labels-error')).toContainText('at most 40')
  await page.fill('#df-labels', '')
  // Link the first test case by its Test Case ID.
  await page.fill('#df-link-case', caseDisplayId)
  await page.getByRole('option', { name: new RegExp(caseDisplayId) }).click()
  await expect(page.getByRole('list', { name: 'Linked test cases' })).toContainText(caseDisplayId)

  await page.getByRole('button', { name: 'Create defect' }).click()
  await expect(page.getByRole('heading', { name: TITLE, level: 1 })).toBeVisible({ timeout: 20_000 })
  createdDefectId = page.url().split('/defects/')[1]
  createdBugId = (await page.locator('main').getByText(/^BUG_\d+$/).first().textContent()) ?? ''
  expect(createdBugId).toMatch(/^BUG_\d+$/)
  await expect(page.getByText('regression', { exact: true }).first()).toBeVisible()
  // Steps tab: both steps, numbered.
  await page.getByRole('tab', { name: /^Steps/ }).click()
  await expect(page.getByText('Apply the code SAVE10')).toBeVisible()
  await expect(page.getByText('Step 2', { exact: true })).toBeVisible()
  // Linked Test Cases tab: the case with its latest execution columns.
  await page.getByRole('tab', { name: /^Linked Test Cases/ }).click()
  const linked = page.getByRole('table', { name: 'Linked test cases' })
  await expect(linked).toContainText(caseDisplayId)
  await expect(linked).toContainText('Verify settlement')
})

test('edit: expected and actual result change after creation, with before / after in the history; assign', async ({ page }) => {
  test.setTimeout(180_000)
  await page.setViewportSize({ width: 1440, height: 900 })
  await signIn(page)
  await page.goto(`/defects/${createdDefectId}`)
  await page.getByRole('link', { name: 'Edit', exact: true }).click()
  await expect(page).toHaveURL(/\/edit$/)
  await expect(page.locator('#df-display-id')).toHaveValue(createdBugId)
  await page.fill('#df-expected', 'The total drops by 10 percent and the code is shown')
  await page.fill('#df-actual', 'The total is unchanged and no code is shown')
  await page.getByRole('button', { name: 'Save changes' }).click()
  await expect(page.getByRole('heading', { name: TITLE, level: 1 })).toBeVisible({ timeout: 20_000 })
  await expect(page.getByText('The total is unchanged and no code is shown')).toBeVisible()
  await page.getByRole('tab', { name: 'History' }).click()
  const history = page.locator('main')
  await expect(history).toContainText('Fields updated')
  await expect(history).toContainText('Actual Result')
  await expect(history).toContainText('The total is unchanged')
  await expect(history).toContainText('changed to')

  // Assign: the dialog lists project users; the assignee shows on the page.
  await page.getByRole('tab', { name: 'Details' }).click()
  await page.getByRole('button', { name: 'Assign', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Assign defect' })
  await nativeSelect(dialog, 'Assignee').selectOption({ label: 'Tester E2E' })
  await dialog.getByRole('button', { name: 'Save assignee' }).click()
  await expect(dialog).toBeHidden()
  await expect(page.getByText('Tester E2E').first()).toBeVisible()
  expect((await api(page, 'get', `/defects/${createdDefectId}`)).data.assigned_to).toBe(t.tester.id)
})

test('status workflow: only allowed next statuses, a resolution where the rules need one, reopen', async ({ page }) => {
  test.setTimeout(180_000)
  await page.setViewportSize({ width: 1440, height: 900 })
  await signIn(page)
  await page.goto(`/defects/${createdDefectId}`)
  // Assigning a New defect moved it to Assigned (the dialog's tick): from Assigned only
  // In Progress, Rejected and Deferred are allowed, so Closed and Fixed are not on the menu.
  expect((await api(page, 'get', `/defects/${createdDefectId}`)).data.status).toBe('Assigned')
  await page.getByRole('button', { name: 'Change status' }).click()
  for (const status of ['In Progress', 'Rejected', 'Deferred']) {
    await expect(page.getByRole('menuitem', { name: status, exact: true })).toBeVisible()
  }
  for (const status of ['New', 'Assigned', 'Open', 'Fixed', 'Retest', 'Closed']) {
    await expect(page.getByRole('menuitem', { name: status, exact: true })).toHaveCount(0)
  }
  // Rejected needs a resolution: the dialog explains it and refuses to continue without one.
  await page.getByRole('menuitem', { name: 'Rejected', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Change status' })
  await expect(dialog.getByText('A resolution is required to set a defect to Rejected')).toBeVisible()
  await dialog.getByRole('button', { name: 'Change status' }).click()
  await expect(dialog.getByText('Choose a resolution to set Rejected.')).toBeVisible()
  await nativeSelect(dialog, 'Resolution').selectOption('Cannot Reproduce')
  await dialog.getByRole('button', { name: 'Change status' }).click()
  await expect(dialog).toBeHidden()
  await expect(page.getByText('Cannot Reproduce').first()).toBeVisible()
  expect((await api(page, 'get', `/defects/${createdDefectId}`)).data.status).toBe('Rejected')

  // Reopen (a shortcut for Rejected -> Reopened); the resolution is cleared.
  await page.getByRole('button', { name: 'Reopen', exact: true }).click()
  await page.getByRole('dialog', { name: 'Change status' }).getByRole('button', { name: 'Change status' }).click()
  await expect(page.getByRole('dialog', { name: 'Change status' })).toBeHidden()
  const reopened = await api(page, 'get', `/defects/${createdDefectId}`)
  expect(reopened.data.status).toBe('Reopened')
  expect(reopened.data.resolution).toBeNull()
  await expect(page.getByText('Reopened 1x')).toBeVisible()
  await changeDefectStatus(page, 'In Progress')
  await changeDefectStatus(page, 'Fixed')
  expect((await api(page, 'get', `/defects/${createdDefectId}`)).data.resolution).toBe('Fixed')
  // History keeps every move.
  await page.getByRole('tab', { name: 'History' }).click()
  await expect(page.locator('main')).toContainText('Status changed')
})

test('linking: link another test case, unlink it, and the test case shows the defect (both directions)', async ({ page }) => {
  test.setTimeout(180_000)
  await page.setViewportSize({ width: 1440, height: 900 })
  await signIn(page)
  await page.goto(`/defects/${createdDefectId}?tab=test-cases`)
  await page.fill('#defect-link-case', secondCaseDisplayId)
  await page.getByRole('option', { name: new RegExp(secondCaseDisplayId) }).click()
  const linked = page.getByRole('table', { name: 'Linked test cases' })
  await expect(linked).toContainText(secondCaseDisplayId)
  // The other direction: the test case's Defects tab lists the defect.
  await page.goto(`/test-cases/${secondCaseId}?tab=defects`)
  await expect(page.getByRole('table', { name: 'Linked defects' })).toContainText(createdBugId)
  // Unlink from the test case side (confirmation), then it is gone on the defect too.
  await page.getByRole('button', { name: `Unlink ${createdBugId}` }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Unlink defect' }).click()
  await expect(page.getByText('No defects linked to this test case.')).toBeVisible()
  await page.goto(`/defects/${createdDefectId}?tab=test-cases`)
  await expect(page.getByRole('table', { name: 'Linked test cases' })).not.toContainText(secondCaseDisplayId)
  // Link it again from the test case's Defects tab, then unlink from the defect side.
  await page.goto(`/test-cases/${secondCaseId}?tab=defects`)
  await page.fill('#case-link-defect', createdBugId)
  await page.getByRole('option', { name: new RegExp(createdBugId) }).click()
  await expect(page.getByRole('table', { name: 'Linked defects' })).toContainText(createdBugId)
  await page.goto(`/defects/${createdDefectId}?tab=test-cases`)
  await page.getByRole('button', { name: `Unlink ${secondCaseDisplayId}` }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Unlink test case' }).click()
  await expect(page.getByRole('table', { name: 'Linked test cases' })).not.toContainText(secondCaseDisplayId)
})

test('fail a step: the defect is created from the draft and linked both ways; an existing one can be linked instead', async ({ page }) => {
  test.setTimeout(240_000)
  await page.setViewportSize({ width: 1440, height: 900 })
  await signIn(page)
  const run = await api(page, 'post', `/projects/${t.projectId}/test-runs`, { name: 'Draft run', run_type: 'Smoke', test_case_ids: [t.caseId] })
  expect(run.status).toBeLessThan(300)
  const runCaseId = run.data.cases[0].id
  await page.goto(`/test-run-cases/${runCaseId}?runId=${run.data.id}`)
  const bar = page.getByRole('group', { name: 'Record a verdict for the current step' })
  await expect(bar).toBeVisible()
  await bar.getByRole('button', { name: /^Pass/ }).click()
  await expect(bar).toContainText('Step 2:', { timeout: 15_000 })
  await page.fill('#actual-result', 'Settlement was not posted')
  await bar.getByRole('button', { name: /^Fail/ }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('heading', { name: 'Report Defect' })).toBeVisible({ timeout: 15_000 })
  // Prefilled from the draft: title with the test case id, the failing step flagged, expected and actual result.
  await expect(dialog.locator('#defect-title')).toHaveValue(new RegExp(`^${caseDisplayId} .* failed$`))
  await expect(dialog.getByText(/Steps to reproduce \(2, failed at step 2\)/)).toBeVisible()
  await expect(dialog.locator('#defect-actual')).toHaveValue('Settlement was not posted')
  await expect(dialog.locator('#defect-expected')).not.toHaveValue('')
  // The mandatory fields are quick-editable: severity has no default and is required.
  await dialog.getByRole('button', { name: 'Report Defect' }).click()
  await expect(dialog.getByText('Severity is required')).toBeVisible()
  await reportDefectFromDialog(page, { severity: 'Critical', description: 'Settlement not posted after the second step' })
  await expect(page.getByText('Defect reported')).toBeVisible({ timeout: 15_000 })
  // The run case panel shows the Bug ID chip.
  const chip = page.getByRole('link', { name: /^BUG_\d+/ }).first()
  await expect(chip).toBeVisible({ timeout: 15_000 })
  const bugId = ((await chip.textContent()) ?? '').match(/BUG_\d+/)![0]
  // Linked both ways: the defect lists the test case and the run, the test case lists the defect.
  await chip.click()
  await page.getByRole('tab', { name: /^Linked Test Cases/ }).click()
  await expect(page.getByRole('table', { name: 'Linked test cases' })).toContainText(caseDisplayId)
  await expect(page.getByRole('table', { name: 'Linked test cases' })).toContainText('Draft run')
  await page.goto(`/test-cases/${t.caseId}?tab=defects`)
  await expect(page.getByRole('table', { name: 'Linked defects' })).toContainText(bugId)

  // Link an existing defect from a second failure instead of creating another.
  const run2 = await api(page, 'post', `/projects/${t.projectId}/test-runs`, { name: 'Link run', run_type: 'Smoke', test_case_ids: [t.caseId] })
  const runCase2 = run2.data.cases[0].id
  await page.goto(`/test-run-cases/${runCase2}?runId=${run2.data.id}`)
  const bar2 = page.getByRole('group', { name: 'Record a verdict for the current step' })
  await expect(bar2).toBeVisible()
  await page.fill('#actual-result', 'Same failure again')
  await bar2.getByRole('button', { name: /^Fail/ }).click()
  const dialog2 = page.getByRole('dialog')
  await expect(dialog2.getByRole('heading', { name: 'Report Defect' })).toBeVisible({ timeout: 15_000 })
  await dialog2.getByRole('tab', { name: 'Link Existing Defect' }).click()
  await dialog2.locator('#existing-defect').fill(bugId)
  await page.getByRole('option', { name: new RegExp(bugId) }).click()
  await dialog2.getByRole('button', { name: 'Link to This Defect' }).click()
  await expect(dialog2).toBeHidden({ timeout: 15_000 })
  await expect(page.getByRole('link', { name: new RegExp(`^${bugId}`) }).first()).toBeVisible({ timeout: 15_000 })
})

async function failedRetest(page: Page, passFinally: boolean) {
  // A defect linked to the approved case, walked to Fixed through the API.
  const created = await api(page, 'post', '/defects', seedDefectBody(t.projectId, { title: passFinally ? 'Retest passes defect' : 'Retest fails defect', test_case_ids: [t.caseId] }))
  expect(created.status, JSON.stringify(created.error)).toBeLessThan(300)
  const id = created.data.id as string
  for (const status of ['Open', 'Fixed']) expect((await api(page, 'patch', `/defects/${id}/status`, { status })).status, status).toBe(200)

  await page.goto(`/defects/${id}`)
  await page.getByRole('button', { name: 'Start retest' }).click()
  const dialog = page.getByRole('dialog', { name: 'Start retest' })
  await expect(dialog.getByText(/Earlier\s+executions are kept/)).toBeVisible()
  await nativeSelect(dialog, 'Tester').selectOption({ label: 'Manager E2E' })
  await dialog.getByRole('button', { name: 'Start retest' }).click()
  await expect(page).toHaveURL(/tab=retests/)
  await expect(page.getByText('Retest', { exact: true }).first()).toBeVisible()
  const timeline = page.getByRole('list', { name: 'Retest timeline' })
  await expect(timeline.getByRole('listitem')).toHaveCount(1)
  await expect(timeline).toContainText('Run case: Not Run')
  // Execute the retest run case in the console.
  await timeline.getByRole('link', { name: 'Open in Execution Console' }).click()
  const bar = page.getByRole('group', { name: 'Record a verdict for the current step' })
  await expect(bar).toBeVisible()
  await bar.getByRole('button', { name: /^Pass/ }).click()
  await expect(bar).toContainText('Step 2:', { timeout: 15_000 })
  if (passFinally) {
    await bar.getByRole('button', { name: /^Pass/ }).click()
  } else {
    await page.fill('#actual-result', 'Still failing after the fix')
    await bar.getByRole('button', { name: /^Fail/ }).click()
    await expect(page.getByRole('dialog').getByRole('heading', { name: 'Report Defect' })).toBeVisible({ timeout: 15_000 })
    await page.getByRole('dialog').getByRole('button', { name: 'Skip' }).click()
  }
  return id
}

test('retest: Fixed -> Retest -> run -> pass closes the defect, history preserved', async ({ page }) => {
  test.setTimeout(240_000)
  await page.setViewportSize({ width: 1440, height: 900 })
  await signIn(page)
  const id = await failedRetest(page, true)
  await page.goto(`/defects/${id}`)
  const banner = page.getByRole('region', { name: 'Retest result' })
  await expect(banner).toBeVisible({ timeout: 15_000 })
  await expect(banner).toContainText('Passed')
  await banner.getByRole('button', { name: 'Retest passed: Close' }).click()
  await expect(page.getByText('Retest passed: defect closed')).toBeVisible({ timeout: 15_000 })
  await expect.poll(async () => (await api(page, 'get', `/defects/${id}`)).data.status, { timeout: 15_000 }).toBe('Closed')
  const closed = await api(page, 'get', `/defects/${id}`)
  expect(closed.data.status).toBe('Closed')
  expect(closed.data.resolution).toBe('Fixed')
  // History is preserved: the retest run case and both history events are still there.
  await page.getByRole('tab', { name: /^Retests/ }).click()
  await expect(page.getByRole('list', { name: 'Retest timeline' })).toContainText('Result recorded: Passed')
  await page.getByRole('tab', { name: 'History' }).click()
  await expect(page.locator('main')).toContainText('Retest started')
  await expect(page.locator('main')).toContainText('Retest result recorded')
})

test('retest: a failing retest reopens the defect and keeps the earlier execution', async ({ page }) => {
  test.setTimeout(240_000)
  await page.setViewportSize({ width: 1440, height: 900 })
  await signIn(page)
  const id = await failedRetest(page, false)
  await page.goto(`/defects/${id}`)
  const banner = page.getByRole('region', { name: 'Retest result' })
  await expect(banner).toBeVisible({ timeout: 15_000 })
  await banner.getByRole('button', { name: 'Retest failed: Reopen' }).click()
  await expect(page.getByText('Reopened 1x')).toBeVisible({ timeout: 15_000 })
  const reopened = await api(page, 'get', `/defects/${id}`)
  expect(reopened.data.status).toBe('Reopened')
  expect(reopened.data.reopened_count).toBe(1)
  await page.getByRole('tab', { name: /^Retests/ }).click()
  await expect(page.getByRole('list', { name: 'Retest timeline' })).toContainText('Result recorded: Failed')
})

test('list: All fields columns, a custom view saved and restored, sort, the export menu and selected rows', async ({ page }) => {
  test.setTimeout(240_000)
  await page.setViewportSize({ width: 1440, height: 900 })
  await signIn(page)
  await page.goto('/defects')
  const head = page.locator('thead')
  // The ten default columns.
  for (const label of ['Bug ID', 'Title', 'Module', 'Severity', 'Priority', 'Status', 'Reporter', 'Assignee', 'Date Reported', 'Fix Version']) {
    await expect(head).toContainText(label)
  }
  await expect(head).not.toContainText('Preconditions')
  await expect(page.getByText(/^Showing 1-\d+ of \d+$/)).toBeVisible()

  // All fields: the 22 of the standard.
  await page.getByRole('button', { name: /^Columns/ }).click()
  await page.getByRole('radio', { name: 'All fields' }).check({ force: true })
  for (const label of ['Description', 'Preconditions', 'Steps to Reproduce', 'Expected Result', 'Actual Result', 'Attachments / Evidence', 'Environment', 'Build / Version Found', 'Resolution', 'Root Cause', 'Linked Issues / Test Case ID', 'Labels / Tags']) {
    await expect(head).toContainText(label)
  }
  expect(await head.locator('th').count()).toBeGreaterThanOrEqual(22)
  await page.keyboard.press('Escape')

  // Custom: Default, then tick Labels / Tags and Environment; save it as a view.
  await page.getByRole('button', { name: /^Columns/ }).click()
  await page.getByRole('radio', { name: 'Default' }).check({ force: true })
  await expect(head).not.toContainText('Labels / Tags')
  await page.getByRole('checkbox', { name: 'Labels / Tags' }).check()
  await page.getByRole('checkbox', { name: 'Environment' }).check()
  await expect(page.getByRole('radio', { name: 'Custom' })).toBeChecked()
  await page.keyboard.press('Escape')
  // Sorting is part of the view.
  await page.getByRole('button', { name: 'Sort by Title' }).click()
  await expect(page).toHaveURL(/sort=title/)
  // The header shows the sort once the page has rendered the new URL; saving before that would miss it.
  await expect(page.getByRole('button', { name: 'Sort by Title, ascending' })).toBeVisible()
  await page.getByRole('button', { name: 'Views' }).click()
  await page.getByLabel('Name for the new view').fill('Labels view')
  await page.getByRole('button', { name: 'Save current' }).click()
  await expect(page.getByRole('menuitem', { name: 'Labels view' })).toBeVisible()
  const saved = await page.request.get(`${API_BASE_URL}/saved-views?list_key=defects`)
  const views = (await saved.json()).data as { name: string; sort: string | null; columns: string[] | null }[]
  const view = views.find((v) => v.name === 'Labels view')
  expect(view?.sort).toBe('title')
  expect(view?.columns).toEqual(expect.arrayContaining(['title', 'labels', 'environment']))

  // Back to Default, forget the local choice, reload: the view still restores its columns and sort.
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: /^Columns/ }).click()
  await page.getByRole('radio', { name: 'Default' }).check({ force: true })
  await page.keyboard.press('Escape')
  await page.evaluate(() => Object.keys(localStorage).filter((k) => k.includes('defect-columns')).forEach((k) => localStorage.removeItem(k)))
  await page.goto('/defects')
  await expect(page.locator('thead')).not.toContainText('Labels / Tags')
  await page.getByRole('button', { name: 'Views' }).click()
  await page.getByRole('menuitem', { name: 'Labels view' }).click()
  await expect(page.locator('thead')).toContainText('Labels / Tags')
  await expect(page.locator('thead')).toContainText('Environment')
  await expect(page).toHaveURL(/sort=title/)
  // The label added when the defect was created shows in its column.
  await expect(page.getByRole('table', { name: 'Defects' })).toContainText('regression')

  // Export: Excel and CSV, all fields or the shown columns, and the selected rows.
  await page.getByRole('button', { name: 'Export' }).click()
  for (const name of ['Excel: all fields', 'Excel: selected columns', 'CSV: all fields', 'CSV: selected columns']) {
    await expect(page.getByRole('menuitem', { name })).toBeVisible()
  }
  await page.keyboard.press('Escape')
  await page.getByRole('checkbox', { name: new RegExp(`^Select ${createdBugId}$`) }).check()
  await page.getByRole('button', { name: 'Export' }).click()
  await expect(page.getByRole('menuitem', { name: /1 selected row/ }).first()).toBeVisible()
  const download = page.waitForEvent('download')
  await page.getByRole('menuitem', { name: /^CSV: 1 selected row/ }).click()
  expect((await download).suggestedFilename()).toBe('defects_export.csv')
  const filtered = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export' }).click()
  await page.getByRole('menuitem', { name: 'Excel: all fields' }).click()
  expect((await filtered).suggestedFilename()).toBe('defects_export.xlsx')
})

test('list: filters (status multi, severity, labels), advanced search by Bug ID, row actions and the drawer', async ({ page }) => {
  test.setTimeout(180_000)
  await page.setViewportSize({ width: 1440, height: 900 })
  await signIn(page)
  await page.goto('/defects')
  // Search by Bug ID.
  await page.locator('#defect-search').fill(createdBugId)
  await expect(page.getByRole('table', { name: 'Defects' }).getByRole('link', { name: TITLE })).toBeVisible()
  await page.locator('#defect-search').fill('')
  // Filters popover: status is a multi-select, labels a free-text list.
  await page.getByRole('button', { name: /^Filters/ }).click()
  const panel = page.getByRole('dialog', { name: 'Filters' })
  // The checkbox state comes back through the URL, so click and then expect (check() verifies at once).
  await panel.getByRole('checkbox', { name: 'Fixed', exact: true }).click()
  await expect(panel.getByRole('checkbox', { name: 'Fixed', exact: true })).toBeChecked()
  await panel.getByRole('checkbox', { name: 'Reopened', exact: true }).click()
  await expect(panel.getByRole('checkbox', { name: 'Reopened', exact: true })).toBeChecked()
  await expect(page.getByRole('list', { name: 'Active filters' }).getByText(/^Status: /)).toBeVisible()
  await panel.getByLabel('Labels', { exact: true }).fill('regression')
  await panel.getByLabel('Labels', { exact: true }).press('Enter')
  await expect(page.getByRole('list', { name: 'Active filters' }).getByText('Labels: regression')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('table', { name: 'Defects' }).getByRole('link', { name: TITLE })).toBeVisible()
  await page.getByRole('button', { name: 'Clear all' }).click()
  // Row drawer and the row menu.
  const row = page.getByRole('row').filter({ hasText: TITLE })
  await row.getByRole('cell').nth(3).click()
  const drawer = page.getByRole('dialog', { name: TITLE })
  await expect(drawer).toBeVisible()
  await expect(drawer.getByText('regression')).toBeVisible()
  await page.keyboard.press('Escape')
  await row.getByRole('button', { name: new RegExp(`^Actions for ${createdBugId}`) }).click()
  for (const name of ['Open', 'Edit', 'Assign', 'Change status', 'Delete']) {
    await expect(page.getByRole('menuitem', { name, exact: true })).toBeVisible()
  }
  await page.keyboard.press('Escape')
})

test('Tester: can report and edit, cannot assign, export or close; the status menu says why', async ({ page }) => {
  test.setTimeout(180_000)
  await page.setViewportSize({ width: 1440, height: 900 })
  await signIn(page, 'tester')
  await page.goto('/defects')
  await expect(page.getByRole('button', { name: 'New Defect' })).toBeEnabled()
  await expect(page.getByRole('button', { name: 'Export' })).toHaveCount(0)
  await page.goto(`/defects/${createdDefectId}`)
  await expect(page.getByRole('link', { name: 'Edit', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Assign', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'More defect actions' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Close', exact: true })).toHaveCount(0)
  // Fixed -> Retest / Reopened / Verified: reopening needs the close permission, Retest does not.
  await page.getByRole('button', { name: 'Change status' }).click()
  await expect(page.getByRole('menuitem', { name: 'Retest', exact: true })).toBeEnabled()
  await expect(page.getByRole('menuitem', { name: /^Reopened/ })).toBeDisabled()
  await page.keyboard.press('Escape')
  // The edit form hides the assignee picker for a role without the permission.
  await page.goto(`/defects/${createdDefectId}/edit`)
  await expect(page.locator('select#df-assignee')).toHaveCount(0)
  await expect(page.getByText('You need the Assign defects permission')).toBeVisible()
})

test('dirty guard: leaving a form with entries asks first; Cancel on a clean form does not', async ({ page }) => {
  test.setTimeout(120_000)
  await page.setViewportSize({ width: 1440, height: 900 })
  await signIn(page)
  await page.goto(`/defects/new?projectId=${t.projectId}`)
  await page.getByRole('button', { name: 'Cancel' }).click()
  await expect(page).toHaveURL(/\/defects\?projectId=/)
  await page.goto(`/defects/new?projectId=${t.projectId}`)
  await page.fill('#df-title', 'Half typed defect')
  await page.getByRole('button', { name: 'Cancel' }).click()
  const dialog = page.getByRole('dialog').or(page.getByRole('alertdialog'))
  await expect(dialog.getByText('Discard unsaved changes?')).toBeVisible()
  await dialog.getByRole('button', { name: 'Discard changes' }).click()
  await expect(page).toHaveURL(/\/defects\?projectId=/)
})

test('responsive: the form, list and detail fit 768 and 375 without sideways scroll, in light and dark', async ({ page }) => {
  test.setTimeout(240_000)
  await signIn(page)
  const noOverflow = async () => {
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0)
  }
  for (const [width, height] of [
    [1440, 900],
    [1280, 800],
    [768, 1024],
    [375, 812],
  ]) {
    await page.setViewportSize({ width, height })
    for (const scheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: scheme })
      for (const path of ['/defects', `/defects/new?projectId=${t.projectId}`, `/defects/${createdDefectId}`, `/defects/${createdDefectId}/edit`]) {
        await page.goto(path)
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
        await noOverflow()
        // The list's ten default columns fit the content area from 1280 up without scrolling inside the table.
        if (path === '/defects' && width >= 1280) {
          const table = page.getByRole('table', { name: 'Defects' })
          await expect(table).toBeVisible()
          expect(await table.evaluate((el) => el.parentElement!.scrollWidth - el.parentElement!.clientWidth)).toBeLessThanOrEqual(0)
        }
      }
    }
  }
})
