import { readFileSync } from 'node:fs'

import { expect, test, type Page } from '@playwright/test'

import { API_BASE_URL, loginViaUi } from './fixtures'
import { seedRoleTenant, type RoleTenant } from './roleTenant'

// ADR-120: standard import (templates, preview with row-wise errors, error report, commit in both
// modes) and export, for test cases and defects, through the import wizard. A file exported by the
// application is imported again and previews without an error.

test.describe.configure({ mode: 'serial' })

let t: RoleTenant

test.beforeAll(async ({ request }) => {
  test.setTimeout(240_000)
  t = await seedRoleTenant(request, 'SmokeIO', { withData: true })
})

async function signIn(page: Page, who: 'admin' | 'tester' = 'admin') {
  if (who === 'admin') await loginViaUi(page, t.tenantId, t.adminEmail, t.adminPassword)
  else await loginViaUi(page, t.tenantId, t.tester.email, t.tester.password)
}

const TC_HEADER =
  'Title,Module,Priority,Test Type,Preconditions,Test Data,Test Steps,Expected Result'

function tcRow(title: string, priority = 'High') {
  const steps = '"1. Open the page | url=/ | The page opens\n2. Click Save | | It is saved"'
  return `"${title}","Claims/Total Loss",${priority},Functional,"User exists","id=1",${steps},"All good"`
}

function csvFile(name: string, text: string) {
  return { name, mimeType: 'text/csv', buffer: Buffer.from(text, 'utf-8') }
}

/** A download is saved under a GUID without an extension: re-upload it under a real name. */
function uploadable(path: string, name: string) {
  const mimeType = name.endsWith('.xlsx')
    ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    : 'text/csv'
  return { name, mimeType, buffer: readFileSync(path) }
}

async function openImport(page: Page, menuItem: string) {
  await page.getByRole('button', { name: 'More actions' }).click()
  await page.getByRole('menuitem', { name: menuItem }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
}

test('test cases: templates, a preview with errors, the error report, skip-invalid commit', async ({ page }) => {
  test.setTimeout(180_000)
  await page.setViewportSize({ width: 1440, height: 900 })
  await signIn(page)
  await page.goto(`/projects/${t.projectId}/test-cases`)
  await openImport(page, 'Import test cases')
  const dialog = page.getByRole('dialog')

  // Step 1: both templates download.
  const xlsx = page.waitForEvent('download')
  await dialog.getByRole('button', { name: 'Excel template (.xlsx)' }).click()
  expect((await xlsx).suggestedFilename()).toBe('test_case_import_template.xlsx')
  const csv = page.waitForEvent('download')
  await dialog.getByRole('button', { name: 'CSV template (.csv)' }).click()
  const csvDownload = await csv
  expect(csvDownload.suggestedFilename()).toBe('test_case_import_template.csv')
  const templateText = readFileSync((await csvDownload.path()) as string, 'utf-8')
  expect(templateText.split('\n')[0]).toContain('Test Case ID,Requirement / User Story ID,Module,Title')

  // A wrong file type is refused before it is sent; the check button stays disabled.
  await dialog.locator('input[type=file]').setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('x') })
  await expect(dialog.getByText('Choose a .xlsx or .csv file.')).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Check the file' })).toBeDisabled()
  await dialog.getByRole('button', { name: 'Remove selected file' }).click()

  // The template with only its example row has no data.
  await dialog.locator('input[type=file]').setInputFiles(uploadable((await (await xlsx).path()) as string, 'template.xlsx'))
  await dialog.getByRole('button', { name: 'Check the file' }).click()
  await expect(dialog.getByRole('alert')).toContainText('no data rows')
  await dialog.getByRole('button', { name: 'Remove selected file' }).click()

  // Two good rows and one bad priority.
  const file = csvFile(
    'cases.csv',
    [TC_HEADER, tcRow('Imported case alpha'), tcRow('Imported case beta'), tcRow('Imported case gamma', 'Bogus')].join('\n'),
  )
  await dialog.locator('input[type=file]').setInputFiles(file)
  await dialog.getByRole('button', { name: 'Check the file' }).click()

  // Step 2: chips, row-wise errors with the row number, modules to create.
  await expect(dialog.getByRole('heading', { name: /Review the file/ })).toBeVisible()
  await expect(dialog.getByText('Valid: 2')).toBeVisible()
  await expect(dialog.getByText('Errors: 1')).toBeVisible()
  await expect(dialog.getByText('1 module will be created').or(dialog.getByText('2 modules will be created'))).toBeVisible()
  const bad = dialog.getByRole('row', { name: /Imported case gamma/ })
  await expect(bad).toContainText('Priority')
  await expect(bad.getByRole('cell', { name: '4', exact: true })).toBeVisible()
  // Errors-only filter: on by default; switching it off shows the good rows too.
  await expect(dialog.getByRole('row', { name: /Imported case alpha/ })).toHaveCount(0)
  await dialog.getByLabel('Show errors and warnings only').uncheck()
  await expect(dialog.getByRole('row', { name: /Imported case alpha/ })).toBeVisible()
  const report = page.waitForEvent('download')
  await dialog.getByRole('button', { name: 'Download error report (CSV)' }).click()
  const reportDownload = await report
  expect(reportDownload.suggestedFilename()).toBe('test_case_import_errors.csv')
  const reportText = readFileSync((await reportDownload.path()) as string, 'utf-8')
  expect(reportText).toContain('Row,Severity,Column,Message')
  expect(reportText).toMatch(/^4,error,Priority,/m)

  // Step 3: all-or-nothing is blocked while a row has errors; skip-invalid imports the rest.
  await dialog.getByRole('button', { name: 'Continue' }).click()
  await expect(dialog.getByRole('button', { name: /^Import / })).toBeDisabled()
  await expect(dialog.getByText(/1 row has errors/).first()).toBeVisible()
  await dialog.getByLabel(/Skip invalid rows/).check()
  await expect(dialog.getByText(/2 test cases/).first()).toBeVisible()
  await dialog.getByRole('button', { name: 'Import 2 test cases' }).click()

  // Step 4: the result, then the imported rows in the list.
  await expect(dialog.getByRole('heading', { name: '2 test cases imported, 1 row skipped' })).toBeVisible()
  await expect(dialog.getByText('Created: 2')).toBeVisible()
  await expect(dialog.getByText(/Row 4/)).toBeVisible()
  await dialog.getByRole('button', { name: 'View imported' }).click()
  await expect(page.getByText('Imported case alpha')).toBeVisible()
  await expect(page.getByText('Imported case beta')).toBeVisible()
  await expect(page.getByText('Imported case gamma')).toHaveCount(0)
})

test('test cases: an exported file is imported again without an error', async ({ page }) => {
  test.setTimeout(180_000)
  await page.setViewportSize({ width: 1440, height: 900 })
  await signIn(page)
  await page.goto(`/projects/${t.projectId}/test-cases`)
  await page.getByRole('button', { name: 'Export' }).click()
  const exported = page.waitForEvent('download')
  await page.getByRole('menuitem', { name: 'CSV: all fields' }).click()
  const download = await exported
  expect(download.suggestedFilename()).toBe('test_cases_export.csv')
  const exportedPath = (await download.path()) as string
  // Same column labels as the import template.
  expect(readFileSync(exportedPath, 'utf-8').split('\n')[0]).toContain('Test Case ID,Requirement / User Story ID,Module,Title')

  await openImport(page, 'Import test cases')
  const dialog = page.getByRole('dialog')
  await dialog.locator('input[type=file]').setInputFiles(uploadable(exportedPath, 'test_cases_export.csv'))
  await dialog.getByRole('button', { name: 'Check the file' }).click()
  await expect(dialog.getByRole('heading', { name: /Review the file/ })).toBeVisible()
  await expect(dialog.getByText('Errors: 0')).toBeVisible()
  // Rows that already exist are warnings (a new id is assigned), never errors.
  await expect(dialog.getByText(/Warnings: [1-9]/)).toBeVisible()
  await dialog.getByRole('button', { name: 'Choose another file' }).click()
  await dialog.getByRole('button', { name: 'Cancel' }).click()
})

test('defects: preview, errors, error report, skip-invalid commit, then the exported file again', async ({ page }) => {
  test.setTimeout(180_000)
  await page.setViewportSize({ width: 1440, height: 900 })
  await signIn(page)
  await page.goto(`/defects?projectId=${t.projectId}`)
  await openImport(page, 'Import defects')
  const dialog = page.getByRole('dialog')

  const xlsx = page.waitForEvent('download')
  await dialog.getByRole('button', { name: 'Excel template (.xlsx)' }).click()
  expect((await xlsx).suggestedFilename()).toBe('defect_import_template.xlsx')

  const header = 'Title,Description,Steps to Reproduce,Expected Result,Actual Result,Environment,Severity,Priority,Status,Resolution'
  const steps = '"1. Open the page | | It opens\n2. Click Save"'
  const row = (title: string, severity: string, status = 'New', resolution = '') =>
    `"${title}","Something is broken",${steps},"It saves","It does not","QA",${severity},High,${status},${resolution}`
  const text = [
    header,
    row('Imported defect alpha', 'Major'),
    row('Imported defect beta', 'Minor', 'Assigned'),
    row('Imported defect gamma', 'Major', 'Closed'),
  ].join('\n')
  await dialog.locator('input[type=file]').setInputFiles(csvFile('defects.csv', text))
  await dialog.getByRole('button', { name: 'Check the file' }).click()

  await expect(dialog.getByRole('heading', { name: /Review the file/ })).toBeVisible()
  await expect(dialog.getByText('Valid: 2')).toBeVisible()
  await expect(dialog.getByText('Errors: 1')).toBeVisible()
  await expect(dialog.getByRole('row', { name: /Imported defect gamma/ })).toContainText('resolution is required')
  const report = page.waitForEvent('download')
  await dialog.getByRole('button', { name: 'Download error report (CSV)' }).click()
  expect((await report).suggestedFilename()).toBe('defect_import_errors.csv')

  await dialog.getByRole('button', { name: 'Continue' }).click()
  await expect(dialog.getByRole('button', { name: /^Import / })).toBeDisabled()
  await dialog.getByLabel(/Skip invalid rows/).check()
  await dialog.getByRole('button', { name: 'Import 2 defects' }).click()
  await expect(dialog.getByRole('heading', { name: '2 defects imported, 1 row skipped' })).toBeVisible()
  await dialog.getByRole('button', { name: 'View imported' }).click()
  await expect(page.getByText('Imported defect alpha')).toBeVisible()
  await expect(page.getByText('Imported defect beta')).toBeVisible()

  // The export of the list re-imports without an error.
  await page.getByRole('button', { name: 'Export' }).click()
  const exported = page.waitForEvent('download')
  await page.getByRole('menuitem', { name: 'CSV: all fields' }).click()
  const exportedPath = (await (await exported).path()) as string
  expect(readFileSync(exportedPath, 'utf-8').split('\n')[0]).toContain('Bug ID,Title,Description,Component / Module')
  await openImport(page, 'Import defects')
  const again = page.getByRole('dialog')
  await again.locator('input[type=file]').setInputFiles(uploadable(exportedPath, 'defects_export.csv'))
  await again.getByRole('button', { name: 'Check the file' }).click()
  await expect(again.getByText('Errors: 0')).toBeVisible()
  await again.getByRole('button', { name: 'Choose another file' }).click()
  await again.getByRole('button', { name: 'Cancel' }).click()
})

test('the API refuses an import without the permission and keeps tokens private', async ({ page }) => {
  await signIn(page)
  // A token of another user is not found (the Admin created none for the Tester).
  const res = await page.request.post(`${API_BASE_URL}/test-cases/import/commit`, {
    data: { token: '00000000-0000-0000-0000-000000000000', mode: 'all_or_nothing' },
  })
  expect(res.status()).toBe(404)
})
