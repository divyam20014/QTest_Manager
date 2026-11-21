import { expect, test } from '@playwright/test'

import { axeFindings, formatFindings } from './a11y'
import { API_BASE_URL, loginViaUi } from './fixtures'
import { seedRoleTenant } from './roleTenant'

// ADR-099: custom dashboards. Build one (KPI + defect aging + saved report),
// reorder, save, reload and see the order persisted; a Tester cannot open an
// Admin's dashboard by id; an Admin's team default shows up for a Tester; and
// the editor passes axe. Throwaway tenant.

test('Custom dashboards: build, reorder, persist, privacy, team default, axe', async ({ browser, request }) => {
  test.setTimeout(300_000)
  const t = await seedRoleTenant(request, 'Dashboards', { withData: true })
  const adminCtx = await browser.newContext()
  const admin = await adminCtx.newPage()
  const testerCtx = await browser.newContext()
  const tester = await testerCtx.newPage()

  try {
    await loginViaUi(admin, t.tenantId, t.adminEmail, t.adminPassword)
    const d = await admin.request.post(`${API_BASE_URL}/defects`, {
      data: { project_id: t.projectId, title: 'Dash seeded defect', severity: 'High' },
    })
    expect(d.status()).toBe(200)
    const rep = await admin.request.post(`${API_BASE_URL}/report-builder/reports`, {
      data: { name: 'Dash defects report', definition: { source: 'defects', fields: ['title'] } },
    })
    expect(rep.status()).toBe(200)

    await admin.goto('/dashboards')
    await expect(admin.getByRole('heading', { name: 'Dashboards', level: 1 })).toBeVisible()
    await admin.getByRole('button', { name: 'New dashboard' }).click()
    await admin.getByLabel('Dashboard name').fill('Ops board')
    await admin.getByRole('button', { name: 'Create', exact: true }).click()
    await expect(admin.getByRole('heading', { name: 'Ops board', level: 1 })).toBeVisible()
    const dashboardId = admin.url().split('/dashboards/')[1]

    await admin.getByRole('button', { name: 'Edit layout' }).click()
    const dialog = admin.getByRole('dialog')
    const addWidget = async (label: string) => {
      await admin.getByRole('button', { name: 'Add widget' }).click()
      await dialog.getByRole('radio', { name: new RegExp(label) }).check()
      return dialog
    }
    await addWidget('Summary tiles')
    await dialog.getByRole('button', { name: 'Add widget', exact: true }).click()
    await addWidget('Defect aging')
    await dialog.getByRole('button', { name: 'Add widget', exact: true }).click()
    await addWidget('Saved report')
    await dialog.getByRole('combobox', { name: 'Saved report' }).selectOption({ label: 'Dash defects report' })
    await dialog.getByRole('button', { name: 'Add widget', exact: true }).click()

    // Order is now: Summary tiles, Defect aging, Saved report. Move the report up one.
    await admin.getByRole('button', { name: 'Move Saved report 3 up' }).click()
    await admin.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(admin.getByText('Layout saved').first()).toBeVisible()

    await admin.reload()
    await expect(admin.getByRole('heading', { name: 'Ops board', level: 1 })).toBeVisible()
    await expect(admin.getByText('Dash seeded defect')).toBeVisible()
    await expect(admin.getByText('Defect aging').first()).toBeVisible()
    const got = await admin.request.get(`${API_BASE_URL}/dashboards/${dashboardId}`)
    const order = (await got.json()).data.widgets.map((w: { widget_type: string }) => w.widget_type)
    expect(order).toEqual(['kpi_summary', 'saved_report', 'defect_aging'])

    // Accessibility: the viewer, then the editor.
    await admin.waitForTimeout(800)
    const problems = formatFindings('dashboard view', await axeFindings(admin))
    await admin.getByRole('button', { name: 'Edit layout' }).click()
    problems.push(...formatFindings('dashboard editor', await axeFindings(admin)))
    expect(problems, problems.join('\n')).toEqual([])
    await admin.getByRole('button', { name: 'Cancel', exact: true }).click()

    // Privacy: a Tester cannot open the Admin's dashboard by id.
    await loginViaUi(tester, t.tenantId, t.tester.email, t.tester.password)
    await tester.goto(`/dashboards/${dashboardId}`)
    await expect(tester.getByRole('heading', { name: 'Page not found' })).toBeVisible()
    await tester.goto('/dashboards')
    await expect(tester.getByRole('link', { name: 'Ops board' })).toHaveCount(0)

    // Team default: the Admin publishes it, the Tester sees and opens it (read only).
    await admin.goto('/dashboards')
    await admin.getByRole('button', { name: 'Set Ops board as team default' }).click()
    await expect(admin.getByText('Team default dashboard set').first()).toBeVisible()
    await tester.goto('/dashboards')
    await expect(tester.getByRole('heading', { name: 'Team default' })).toBeVisible()
    await tester.getByRole('link', { name: 'Ops board' }).click()
    await expect(tester.getByRole('heading', { name: 'Ops board', level: 1 })).toBeVisible()
    await expect(tester.getByText('Active projects')).toBeVisible()
    await expect(tester.getByRole('button', { name: 'Edit layout' })).toHaveCount(0)
  } finally {
    await adminCtx.close()
    await testerCtx.close()
  }
})
