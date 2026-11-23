import { expect, test, type Page } from '@playwright/test'

import { API_BASE_URL, loginViaUi, seedCaseBody } from './fixtures'
import { seedRoleTenant, type RoleTenant } from './roleTenant'

// ADR-117: the Test Case UI on the 22-field standard -- the six-section form with inline
// validation, the step builder, the column modes and saved views, duplicate, export, and
// the executions history that fills once a step is failed with an actual result.

test.describe.configure({ mode: 'serial' })

let t: RoleTenant

test.beforeAll(async ({ request }) => {
  test.setTimeout(240_000)
  t = await seedRoleTenant(request, 'tcstd', { withData: true })
})

const list = (page: Page) => page.goto(`/projects/${t.projectId}/test-cases`)
const actions = (page: Page) => page.locator('[data-field="action"]')

test('create: inline validation, every mandatory field, step reorder by keyboard, saved as draft', async ({ page }) => {
  test.setTimeout(180_000)
  await page.setViewportSize({ width: 1440, height: 900 })
  await loginViaUi(page, t.tenantId, t.adminEmail, t.adminPassword)
  await list(page)
  await page.getByRole('button', { name: 'New Test Case' }).click()
  await expect(page).toHaveURL(/\/test-cases\/new$/)
  await expect(page.getByRole('heading', { name: 'New Test Case', level: 1 })).toBeVisible()
  // Six collapsible sections.
  for (const name of [
    'Basic Information',
    'Classification',
    'Test Preparation',
    'Test Execution Instructions',
    'Execution Details',
    'Additional Information',
  ]) {
    await expect(page.getByRole('button', { name: new RegExp(name) })).toBeVisible()
  }
  await expect(page.locator('#tc-display-id')).toHaveAttribute('readonly', '')

  // Validation on blur, inline and linked to the field.
  await page.fill('#tc-title', 'abc')
  await page.locator('#tc-title').blur()
  await expect(page.locator('#tc-title-error')).toContainText('at least 5')
  await expect(page.locator('#tc-title')).toHaveAttribute('aria-invalid', 'true')

  // Saving the empty form names every missing field and keeps what was typed.
  await page.getByRole('button', { name: 'Save as Draft' }).click()
  await expect(page.getByText('Module is required').first()).toBeVisible()
  await expect(page.getByText('Preconditions are required').first()).toBeVisible()
  await expect(page.getByText('Test data is required').first()).toBeVisible()
  await expect(page.getByText('Expected result is required').first()).toBeVisible()
  await expect(page.getByText(/to fix/).first()).toBeVisible()
  await expect(page.locator('#tc-title')).toHaveValue('abc')

  // Fill it in. Module is chosen from the existing tree.
  await page.fill('#tc-title', 'Verify claim intake rejects a duplicate policy number')
  await page.locator('select#tc-module-0').selectOption({ label: 'Claims' })
  await page.selectOption('select#tc-priority', 'High')
  await page.selectOption('select#tc-severity', 'Major')
  await page.selectOption('select#tc-automation', 'Candidate for Automation')
  await page.fill('#tc-requirement', 'US-142')
  await page.fill('#tc-preconditions', 'An open claim exists for policy PX-1')
  await page.fill('#tc-test-data', '{"policy": "PX-1"}')
  await expect(page.getByText('Valid JSON', { exact: true })).toBeVisible()
  await page.fill('#tc-expected', 'The duplicate is refused with a clear message')

  // Step builder: three rows, reordered with the keyboard-accessible buttons, remove + undo.
  await actions(page).nth(0).fill('Open the intake form')
  await page.locator('[data-field="expected"]').nth(0).fill('Form opens')
  await page.getByRole('button', { name: 'Add step' }).click()
  await actions(page).nth(1).fill('Enter policy PX-1')
  await page.locator('[data-field="expected"]').nth(1).fill('Policy accepted')
  await page.getByRole('button', { name: 'Add step' }).click()
  await actions(page).nth(2).fill('Submit the claim')
  await page.locator('[data-field="expected"]').nth(2).fill('Duplicate refused')
  await page.getByRole('button', { name: 'Move step 3 up' }).focus()
  await page.keyboard.press('Enter')
  await expect(actions(page).nth(1)).toHaveValue('Submit the claim')
  await expect(actions(page).nth(2)).toHaveValue('Enter policy PX-1')
  // Keyboard on the drag handle too.
  await page.getByRole('button', { name: /Reorder step 2/ }).focus()
  await page.keyboard.press('ArrowUp')
  await expect(actions(page).nth(0)).toHaveValue('Submit the claim')
  await page.getByRole('button', { name: 'Remove step 3' }).click()
  await expect(actions(page)).toHaveCount(2)
  await page.getByRole('button', { name: 'Undo' }).click()
  await expect(actions(page)).toHaveCount(3)
  await expect(actions(page).nth(2)).toHaveValue('Enter policy PX-1')
  // Put the steps back in a sensible order by keyboard.
  await page.getByRole('button', { name: 'Move step 1 down' }).click()
  await page.getByRole('button', { name: 'Move step 2 down' }).click()
  await expect(actions(page).nth(0)).toHaveValue('Open the intake form')
  await expect(actions(page).nth(1)).toHaveValue('Enter policy PX-1')
  await expect(actions(page).nth(2)).toHaveValue('Submit the claim')

  // Execution Details is read-only and says so.
  await page.getByRole('button', { name: /Execution Details/ }).click()
  await expect(page.getByText(/Execution happens in a test run/)).toBeVisible()

  await page.getByRole('button', { name: 'Save as Draft' }).click()
  await expect(page.getByRole('heading', { name: 'Verify claim intake rejects a duplicate policy number', level: 1 })).toBeVisible({
    timeout: 20_000,
  })
  await expect(page.getByText(/^TC_\d{6}$/).first()).toBeVisible()
  await expect(page.getByText('Review Status: Draft')).toBeVisible()
  // The tabs of the detail page.
  for (const tab of ['Details', 'Steps', 'Executions', 'Versions', 'Comments & Attachments', 'History']) {
    await expect(page.getByRole('tab', { name: new RegExp(tab) })).toBeVisible()
  }
  await page.getByRole('tab', { name: /^Steps/ }).click()
  await expect(page.getByText('Open the intake form')).toBeVisible()
  await page.getByRole('tab', { name: /^History/ }).click()
  await expect(page.getByText('Test case created')).toBeVisible()
})

test('list: Review Status label, All fields mode, custom view saved and restored after reload', async ({ page }) => {
  test.setTimeout(180_000)
  await page.setViewportSize({ width: 1440, height: 900 })
  await loginViaUi(page, t.tenantId, t.adminEmail, t.adminPassword)
  await list(page)
  const head = page.locator('thead')
  await expect(head).toContainText('Test Case ID')
  for (const label of ['Title', 'Module', 'Test Type', 'Priority', 'Automation Status', 'Execution Status', 'Executed By', 'Last Execution Date']) {
    await expect(head).toContainText(label)
  }
  // The lifecycle status is "Review Status" everywhere; the old word is gone from the tabs.
  await expect(page.getByRole('tablist', { name: 'Review status' })).toBeVisible()
  await expect(page.getByRole('tab', { name: /^Approved/ })).toBeVisible()
  await expect(head).not.toContainText('Severity')

  // All fields: the 22 fields of the standard.
  await page.getByRole('button', { name: /^Columns/ }).click()
  await page.getByRole('radio', { name: 'All fields' }).check({ force: true })
  for (const label of ['Requirement / User Story ID', 'Description', 'Severity', 'Environment', 'Preconditions', 'Test Data', 'Test Steps', 'Expected Result', 'Postconditions', 'Actual Result', 'Defect / Bug ID', 'Created By', 'Comments / Attachments']) {
    await expect(head).toContainText(label)
  }
  expect(await head.locator('th').count()).toBeGreaterThanOrEqual(22)
  await page.keyboard.press('Escape')
  await expect(head).not.toContainText('Review Status')

  // Custom: back to Default, then tick Severity and Review Status.
  await page.getByRole('button', { name: /^Columns/ }).click()
  await page.getByRole('radio', { name: 'Default' }).check({ force: true })
  await expect(head).not.toContainText('Severity')
  await page.getByRole('checkbox', { name: 'Severity' }).check()
  await page.getByRole('checkbox', { name: 'Review Status' }).check()
  await expect(page.getByRole('radio', { name: 'Custom' })).toBeChecked()
  await expect(head).toContainText('Severity')
  await expect(head).toContainText('Review Status')
  await page.keyboard.press('Escape')

  // Save it as a view (filters + sort + columns).
  await page.getByRole('button', { name: 'Views' }).click()
  await page.getByLabel('Name for the new view').fill('Severity view')
  await page.getByRole('button', { name: 'Save current' }).click()
  await expect(page.getByRole('menuitem', { name: 'Severity view' })).toBeVisible()
  const saved = await page.request.get(`${API_BASE_URL}/saved-views?list_key=test_cases`)
  const views = (await saved.json()).data as { name: string; columns: string[] | null }[]
  expect(views.find((v) => v.name === 'Severity view')?.columns).toEqual(expect.arrayContaining(['title', 'severity', 'review_status']))

  // Switch back to Default, reload: the saved view still exists server-side and restores its columns.
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: /^Columns/ }).click()
  await page.getByRole('radio', { name: 'Default' }).check({ force: true })
  await page.keyboard.press('Escape')
  await page.evaluate(() => Object.keys(localStorage).filter((k) => k.includes('test-case-columns')).forEach((k) => localStorage.removeItem(k)))
  await page.reload()
  await expect(page.locator('thead')).not.toContainText('Severity')
  await page.getByRole('button', { name: 'Views' }).click()
  await page.getByRole('menuitem', { name: 'Severity view' }).click()
  await expect(page.locator('thead')).toContainText('Severity')
  await expect(page.locator('thead')).toContainText('Review Status')
})

test('filters, row menu: duplicate opens the copy; export menu offers all fields or selected columns', async ({ page }) => {
  test.setTimeout(180_000)
  await page.setViewportSize({ width: 1440, height: 900 })
  await loginViaUi(page, t.tenantId, t.adminEmail, t.adminPassword)
  await list(page)

  // Search by Test Case ID prefix and filter by execution status.
  await page.locator('#tc-search').fill('settlement')
  await expect(page.getByRole('link', { name: 'Verify settlement' })).toBeVisible()
  await page.getByRole('button', { name: /Filters/ }).click()
  await page.locator('select#tc-filter-execution').selectOption('Fail')
  await expect(page.getByText('Execution status: Fail')).toBeVisible()
  await expect(page.getByRole('link', { name: 'Verify settlement' })).toBeVisible()
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: /Clear all/ }).first().click()
  await page.locator('#tc-search').fill('')

  // Duplicate from the row menu: a new Draft opens.
  await page.locator('#tc-search').fill('Verify settlement')
  await page.getByRole('button', { name: /^Actions for TC_/ }).first().click()
  await page.getByRole('menuitem', { name: 'Duplicate' }).click()
  await expect(page.getByRole('heading', { name: 'Verify settlement (Copy)', level: 1 })).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText('Review Status: Draft')).toBeVisible()

  // Export: Excel and CSV, all fields or the selected columns.
  await list(page)
  await page.getByRole('button', { name: 'Export' }).click()
  await expect(page.getByRole('menuitem', { name: 'Excel: all fields' })).toBeVisible()
  await expect(page.getByRole('menuitem', { name: 'Excel: selected columns' })).toBeVisible()
  await expect(page.getByRole('menuitem', { name: 'CSV: all fields' })).toBeVisible()
  const download = page.waitForEvent('download')
  await page.getByRole('menuitem', { name: 'CSV: selected columns' }).click()
  expect((await download).suggestedFilename()).toBe('test_cases_export.csv')
})

test('execution console: failing a step needs an actual result, which then shows in the Executions tab', async ({ page, request }) => {
  test.setTimeout(240_000)
  await page.setViewportSize({ width: 1440, height: 900 })
  await loginViaUi(page, t.tenantId, t.adminEmail, t.adminPassword)
  // A fresh approved case and run, created through the API as the signed-in admin.
  const post = async (path: string, data?: unknown) => {
    const res = await page.request.post(`${API_BASE_URL}${path}`, { data })
    expect(res.ok(), `${path}: ${await res.text()}`).toBeTruthy()
    return (await res.json()).data
  }
  void request
  const tc = await post(
    `/projects/${t.projectId}/test-cases`,
    await seedCaseBody(page.request, t.projectId!, { title: 'Console actual result case' }),
  )
  await post(`/test-cases/${tc.id}/submit-review`, {})
  await post(`/test-cases/${tc.id}/approve`)
  const run = await post(`/projects/${t.projectId}/test-runs`, { name: 'Actual result run', run_type: 'Smoke', test_case_ids: [tc.id] })
  await page.goto(`/test-run-cases/${run.cases[0].id}?runId=${run.id}`)
  const bar = page.getByRole('group', { name: 'Record a verdict for the current step' })
  await expect(bar).toBeVisible()
  await bar.getByRole('button', { name: /^Fail/ }).click()
  await expect(page.locator('#actual-result-error')).toContainText('what actually happened')
  await expect(page.locator('#actual-result')).toBeFocused()
  await page.fill('#actual-result', 'The page returned a 500 error')
  await bar.getByRole('button', { name: /^Fail/ }).click()
  await expect(page.getByRole('heading', { name: 'Report Defect' })).toBeVisible({ timeout: 15_000 })
  await page.keyboard.press('Escape')

  await page.goto(`/test-cases/${tc.id}?tab=executions`)
  const table = page.getByRole('table', { name: 'Execution history' })
  await expect(table).toBeVisible()
  await expect(table).toContainText('Actual result run')
  await expect(table).toContainText('Fail')
  await expect(table).toContainText('The page returned a 500 error')
  await expect(page.getByRole('tab', { name: /^Executions/ })).toHaveAttribute('aria-selected', 'true')
})
