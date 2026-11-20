import { expect, test, type Page } from '@playwright/test'

import { API_BASE_URL, loginViaUi } from './fixtures'
import { seedRoleTenant } from './roleTenant'

// ADR-092 (RBAC Phase 4): a release freeze, end to end, on a throwaway tenant.
// Admin creates the rule in the UI; a Manager sees the banner and is blocked
// with the rule's reason; Admin is exempt; disabling the rule restores access.

const REASON = 'Release 9.9 code freeze until the window closes'

function localInputValue(offsetHours: number): string {
  const d = new Date(Date.now() + offsetHours * 3600_000)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

async function noHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
  expect(overflow).toBeLessThanOrEqual(0)
}

async function createCase(page: Page, projectId: string, title: string) {
  const res = await page.request.post(`${API_BASE_URL}/projects/${projectId}/test-cases`, {
    data: { title, priority: 'High', steps: [{ action: 'a', expected: 'b' }] },
  })
  const body = await res.json().catch(() => null)
  return { status: res.status(), error: body?.error }
}

test('Release freeze: Admin sets it, Manager is blocked with the reason, disabling restores access', async ({
  browser,
  request,
}) => {
  test.setTimeout(240_000)
  const t = await seedRoleTenant(request, 'AccessRules', { withData: true })
  const shots = process.env.E2E_SHOTS_DIR

  const adminCtx = await browser.newContext()
  const admin = await adminCtx.newPage()
  const managerCtx = await browser.newContext()
  const manager = await managerCtx.newPage()

  try {
    // Off by default: a Manager can work and sees no banner.
    await loginViaUi(manager, t.tenantId, t.manager.email, t.manager.password)
    await manager.goto(`/projects/${t.projectId}/test-cases`)
    await expect(manager.getByTestId('access-rule-banner')).toHaveCount(0)
    expect((await createCase(manager, t.projectId!, 'Before the freeze case')).status).toBe(200)

    // Admin creates the rule through the UI.
    await loginViaUi(admin, t.tenantId, t.adminEmail, t.adminPassword)
    await admin.goto('/admin/access-rules')
    await expect(admin.getByRole('heading', { name: 'Access rules' })).toBeVisible()
    await expect(admin.getByText('No access rules yet')).toBeVisible()
    await admin.getByRole('button', { name: 'New rule' }).click()

    // Validation: an empty form is refused inline, nothing is sent.
    await admin.getByRole('button', { name: 'Save rule' }).click()
    await expect(admin.getByText('Enter a name')).toBeVisible()
    await expect(admin.getByText('Choose a start time')).toBeVisible()

    await admin.fill('#rule-name', 'Release 9.9 freeze')
    await admin.fill('#rule-starts', localInputValue(-1))
    await admin.fill('#rule-ends', localInputValue(2))
    await admin.fill('#rule-reason', REASON)
    await admin.getByRole('button', { name: 'Save rule' }).click()
    await expect(admin.getByRole('heading', { name: 'Release 9.9 freeze' })).toBeVisible()
    await expect(admin.getByText('Active now')).toBeVisible()
    if (shots) await admin.screenshot({ path: `${shots}/access-rules-1280.png`, fullPage: true })

    // Manager: banner with the reason and end time; mutation refused with the reason.
    await manager.goto(`/projects/${t.projectId}/test-cases`)
    const banner = manager.getByTestId('access-rule-banner')
    await expect(banner).toContainText(REASON)
    await expect(banner).toContainText('Until')
    if (shots) await manager.screenshot({ path: `${shots}/access-rule-banner-1280.png` })
    const blocked = await createCase(manager, t.projectId!, 'During the freeze case')
    expect(blocked.status).toBe(403)
    expect(blocked.error.code).toBe('blocked_by_access_rule')
    expect(blocked.error.message).toBe(REASON)

    // The browser form shows the reason, not "try again".
    await manager.getByRole('button', { name: 'New Test Case' }).click()
    await manager.fill('#title', 'Blocked in the browser')
    await manager.locator('input[placeholder="Action"]').first().fill('Open the claim')
    await manager.locator('input[placeholder="Expected outcome"]').first().fill('Claim opens')
    await manager.getByRole('button', { name: /^(Create|Save)/ }).last().click()
    await expect(manager.getByText(REASON)).not.toHaveCount(1) // banner + the refusal message
    await expect(manager.getByText(/try again/i)).toHaveCount(0)

    // Admin is exempt and can still work.
    expect((await createCase(admin, t.projectId!, 'Admin during the freeze')).status).toBe(200)

    // Phone width: the banner and the admin screen fit.
    await manager.setViewportSize({ width: 390, height: 844 })
    await manager.goto(`/projects/${t.projectId}/test-cases`)
    await expect(manager.getByTestId('access-rule-banner')).toBeVisible()
    await noHorizontalOverflow(manager)
    if (shots) await manager.screenshot({ path: `${shots}/access-rule-banner-390.png` })
    await admin.setViewportSize({ width: 390, height: 844 })
    await admin.goto('/admin/access-rules')
    await expect(admin.getByRole('heading', { name: 'Release 9.9 freeze' })).toBeVisible()
    await noHorizontalOverflow(admin)
    if (shots) await admin.screenshot({ path: `${shots}/access-rules-390.png`, fullPage: true })
    await admin.setViewportSize({ width: 1280, height: 800 })

    // Disable the rule in the UI: access is restored and the banner disappears.
    await admin.goto('/admin/access-rules')
    await admin.getByRole('button', { name: 'Disable rule Release 9.9 freeze' }).click()
    await expect(admin.getByText('Disabled', { exact: true })).toBeVisible()
    await manager.setViewportSize({ width: 1280, height: 800 })
    await manager.goto(`/projects/${t.projectId}/test-cases`)
    await expect(manager.getByTestId('access-rule-banner')).toHaveCount(0)
    expect((await createCase(manager, t.projectId!, 'After the freeze case')).status).toBe(200)

    // Delete goes through a confirmation.
    await admin.getByRole('button', { name: 'Delete rule Release 9.9 freeze' }).click()
    await admin.getByRole('button', { name: 'Delete rule', exact: true }).last().click()
    await expect(admin.getByText('No access rules yet')).toBeVisible()
  } finally {
    await adminCtx.close()
    await managerCtx.close()
  }
})

test('Access Rules screen is hidden from a Manager', async ({ browser, request }) => {
  test.setTimeout(120_000)
  const t = await seedRoleTenant(request, 'AccessRulesNav')
  const ctx = await browser.newContext()
  const page = await ctx.newPage()
  try {
    await loginViaUi(page, t.tenantId, t.manager.email, t.manager.password)
    await expect(page.getByRole('link', { name: 'Access Rules' })).toHaveCount(0)
    await page.goto('/admin/access-rules')
    await expect(page.getByText(/don.t have access|no access/i).first()).toBeVisible()
  } finally {
    await ctx.close()
  }
})
