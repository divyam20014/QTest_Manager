import { expect, test } from '@playwright/test'

import { API_BASE_URL, bootstrapTenant, loginViaUi } from './fixtures'

// The compliance report data is gated by `report.compliance_export` (Admin and
// Manager hold it, Tester does not). The sidebar entry and the page must follow
// that permission instead of showing a link a role cannot use.

test('Compliance Reports is offered to, and opens for, only the roles that can export it', async ({
  page,
  browser,
  request,
}) => {
  const tenant = await bootstrapTenant(request, 'ComplianceNav')
  const suffix = tenant.tenantId.slice(0, 8)

  const loginRes = await request.post(`${API_BASE_URL}/auth/login`, {
    data: { tenant_id: tenant.tenantId, email: tenant.adminEmail, password: tenant.adminPassword },
  })
  await request.post(`${API_BASE_URL}/auth/mfa/verify`, {
    data: { code: (await loginRes.json()).data.debug_code },
  })
  const people = {
    manager: { email: `manager-${suffix}@example.com`, password: 'ManagerPassw0rd1!' },
    tester: { email: `tester-${suffix}@example.com`, password: 'TesterPassw0rd1!' },
  }
  for (const [role, p] of Object.entries(people)) {
    const res = await request.post(`${API_BASE_URL}/users`, {
      data: { email: p.email, name: `${role} E2E`, role, password: p.password },
    })
    expect(res.ok()).toBeTruthy()
  }

  const complianceLink = (p: typeof page) => p.getByRole('link', { name: /Compliance Reports/ })

  // ---- Tester: no link, and the URL shows "No access" without provoking a 403.
  await loginViaUi(page, tenant.tenantId, people.tester.email, people.tester.password)
  await expect(page.getByRole('link', { name: 'Reports', exact: true }).first()).toBeVisible()
  await expect(complianceLink(page)).toHaveCount(0)
  const refused: string[] = []
  page.on('response', (r) => {
    if (r.status() === 403) refused.push(r.url().replace(API_BASE_URL, ''))
  })
  await page.goto('/reporting/print')
  await expect(page.getByTestId('no-access')).toBeVisible()
  expect(refused, 'the guard stops the page before it requests data').toEqual([])
  // The ordinary Reports page is still open to a Tester.
  await page.goto('/reporting')
  await expect(page.getByTestId('no-access')).toHaveCount(0)
  // ...but without the compliance export buttons it cannot use.
  await expect(page.getByRole('heading', { name: 'Reporting', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Export', exact: true })).toHaveCount(0)

  // ---- Manager and Admin: link offered, page opens.
  for (const who of [
    { email: people.manager.email, password: people.manager.password },
    { email: tenant.adminEmail, password: tenant.adminPassword },
  ]) {
    const context = await browser.newContext()
    const p = await context.newPage()
    await loginViaUi(p, tenant.tenantId, who.email, who.password)
    await expect(complianceLink(p).first()).toBeVisible()
    await p.goto('/reporting')
    await p.getByRole('button', { name: 'Export', exact: true }).click()
    await expect(p.getByRole('menuitem', { name: 'Print' })).toBeVisible()
    await expect(p.getByRole('menuitem', { name: 'CSV' })).toBeVisible()
    await p.goto('/reporting/print')
    await expect(p.getByRole('heading', { name: /Compliance Report/ }).first()).toBeVisible()
    await expect(p.getByTestId('no-access')).toHaveCount(0)
    await context.close()
  }
})
