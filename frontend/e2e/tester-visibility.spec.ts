import { expect, test, type Page } from '@playwright/test'

import { API_BASE_URL, loginViaUi } from './fixtures'
import { seedRoleTenant } from './roleTenant'

// ADR-093: Admin turns on both Tester visibility switches in the UI on a
// throwaway tenant; the Tester sees only the case assigned to them, has no
// Reports link and gets NoAccess on /reporting; turning them off restores it.

async function openTesterVisibility(page: Page) {
  await page.goto('/settings')
  await page.getByRole('tab', { name: 'Data' }).click()
  await expect(page.getByRole('heading', { name: 'Tester Visibility' })).toBeVisible()
}

test('Tester visibility switches hide unassigned cases and Reports, and restore on off', async ({
  browser,
  request,
}) => {
  test.setTimeout(240_000)
  const t = await seedRoleTenant(request, 'TesterVis', { withData: true })

  const adminCtx = await browser.newContext()
  const admin = await adminCtx.newPage()
  const testerCtx = await browser.newContext()
  const tester = await testerCtx.newPage()

  try {
    await loginViaUi(admin, t.tenantId, t.adminEmail, t.adminPassword)
    const mine = await admin.request.post(`${API_BASE_URL}/projects/${t.projectId}/test-cases`, {
      data: {
        title: 'Assigned to the tester',
        priority: 'High',
        assignee_id: t.tester.id,
        steps: [{ action: 'a', expected: 'b' }],
      },
    })
    expect(mine.status()).toBe(200)

    // Off by default: the Tester sees both cases and the Reports link.
    await loginViaUi(tester, t.tenantId, t.tester.email, t.tester.password)
    await tester.goto(`/projects/${t.projectId}/test-cases`)
    await expect(tester.getByText('Verify settlement').first()).toBeVisible()
    await expect(tester.getByRole('link', { name: 'Reports', exact: true }).first()).toBeVisible()

    await openTesterVisibility(admin)
    await admin.getByLabel(/Testers see only test cases assigned to them/).click()
    await expect(admin.getByText('Tester visibility saved').first()).toBeVisible()
    await admin.getByLabel(/Hide Reports from Testers/).click()
    await expect(admin.getByLabel(/Hide Reports from Testers/)).toBeChecked()

    await tester.goto(`/projects/${t.projectId}/test-cases`)
    await expect(tester.getByText('Assigned to the tester').first()).toBeVisible()
    await expect(tester.getByText('Verify settlement')).toHaveCount(0)
    await expect(tester.getByRole('link', { name: 'Reports', exact: true })).toHaveCount(0)
    await tester.goto('/reporting')
    await expect(tester.getByTestId('no-access')).toBeVisible()
    await tester.goto('/')
    await expect(tester.getByRole('heading', { name: 'Dashboard' }).first()).toBeVisible()

    // Off again: everything is back.
    await openTesterVisibility(admin)
    await admin.getByLabel(/Testers see only test cases assigned to them/).click()
    await expect(admin.getByLabel(/Testers see only test cases assigned to them/)).not.toBeChecked()
    await admin.getByLabel(/Hide Reports from Testers/).click()
    await expect(admin.getByLabel(/Hide Reports from Testers/)).not.toBeChecked()
    await tester.goto(`/projects/${t.projectId}/test-cases`)
    await expect(tester.getByText('Verify settlement').first()).toBeVisible()
    await expect(tester.getByRole('link', { name: 'Reports', exact: true }).first()).toBeVisible()
  } finally {
    await adminCtx.close()
    await testerCtx.close()
  }
})
