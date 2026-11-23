import { expect, test } from '@playwright/test'

import { API_BASE_URL, loginViaUi, nativeSelect, seedDefectBody } from './fixtures'
import { seedRoleTenant } from './roleTenant'

// ADR-098: build a defects report (filter + group by severity), run, save,
// reload and run the saved report, export CSV; then a Tester gets NoAccess
// once Reports are hidden from Testers. Throwaway tenant.

test('Report builder: build, run, save, reload, export, and hidden-from-Testers', async ({ browser, request }) => {
  test.setTimeout(240_000)
  const t = await seedRoleTenant(request, 'RepBuilder', { withData: true })
  const adminCtx = await browser.newContext()
  const admin = await adminCtx.newPage()
  const testerCtx = await browser.newContext()
  const tester = await testerCtx.newPage()

  try {
    await loginViaUi(admin, t.tenantId, t.adminEmail, t.adminPassword)
    for (const [title, severity] of [
      ['Builder defect one', 'High'],
      ['Builder defect two', 'High'],
      ['Builder defect three', 'Low'],
    ]) {
      const r = await admin.request.post(`${API_BASE_URL}/defects`, {
        data: seedDefectBody(t.projectId, { title, severity }),
      })
      expect(r.status()).toBe(200)
    }

    await admin.goto('/reporting/builder')
    await expect(admin.getByRole('heading', { name: 'Report builder' })).toBeVisible()

    await admin.getByRole('button', { name: 'Add filter' }).click()
    await nativeSelect(admin, 'Filter 1 field').selectOption({ label: 'Severity' })
    await nativeSelect(admin, 'Filter 1 value').selectOption('High')
    await nativeSelect(admin, 'Group by (count)').selectOption({ label: 'Severity' })
    await admin.getByRole('button', { name: 'Run', exact: true }).click()
    await expect(admin.getByText('Builder defect')).toHaveCount(0)
    await expect(admin.getByRole('columnheader', { name: 'Count' })).toBeVisible()
    await expect(admin.getByRole('cell', { name: '3', exact: true })).toBeVisible()

    await admin.getByLabel('Report name').fill('High severity count')
    await admin.getByRole('button', { name: 'Save report', exact: true }).click()
    await expect(admin.getByText('Report saved').first()).toBeVisible()

    await admin.reload()
    await admin.getByRole('button', { name: 'High severity count', exact: true }).click()
    await expect(admin.getByRole('cell', { name: '3', exact: true })).toBeVisible()

    const downloadPromise = admin.waitForEvent('download')
    await admin.getByRole('button', { name: 'Export CSV' }).click()
    const download = await downloadPromise
    const path = await download.path()
    const { statSync } = await import('node:fs')
    expect(statSync(path).size).toBeGreaterThan(0)

    // Hidden from Testers: NoAccess on the builder.
    await loginViaUi(tester, t.tenantId, t.tester.email, t.tester.password)
    await tester.goto('/reporting/builder')
    await expect(tester.getByRole('heading', { name: 'Report builder' })).toBeVisible()
    const hide = await admin.request.patch(`${API_BASE_URL}/settings`, {
      data: { reports_hidden_from_testers: true },
    })
    expect(hide.status()).toBe(200)
    await tester.goto('/reporting/builder')
    await expect(tester.getByTestId('no-access')).toBeVisible()
  } finally {
    await adminCtx.close()
    await testerCtx.close()
  }
})
