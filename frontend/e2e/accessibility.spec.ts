import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'

import { bootstrapTenant, loginViaUi } from './fixtures'

// Phase 10.9 accessibility pass: axe-core scan (WCAG 2.1 A/AA) against
// every main screen, with a real tenant's data behind it rather than an
// empty-state shell. Failing on "serious"/"critical" impact only -- a
// "minor"/"moderate" finding on a dev-stage app does not block the phase,
// but anything serious or critical is a real defect to fix now.
async function expectNoSeriousViolations(page: import('@playwright/test').Page) {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()
  const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
  expect(serious, JSON.stringify(serious, null, 2)).toEqual([])
}

test.describe('accessibility', () => {
  test('Login screen has no serious violations', async ({ page }) => {
    await page.goto('/')
    await page.waitForSelector('text=Sign in to your organization')
    await expectNoSeriousViolations(page)
  })

  test('Dashboard, Projects, Reports, Defects, Users & Roles have no serious violations', async ({
    page,
    request,
  }) => {
    const tenant = await bootstrapTenant(request, 'A11y')
    await loginViaUi(page, tenant.tenantId, tenant.adminEmail, tenant.adminPassword)
    await expectNoSeriousViolations(page)

    await page.click('a:has-text("Projects")')
    await page.waitForSelector('h1:has-text("Projects")')
    await expectNoSeriousViolations(page)

    await page.click('a:has-text("Defects")')
    await page.waitForSelector('h1:has-text("Defects")')
    await expectNoSeriousViolations(page)

    await page.click('a:has-text("Reports")')
    await page.waitForSelector('text=Project & Test Case Distribution by Domain')
    await page.waitForTimeout(500) // let the chart's SVG settle before scanning
    await expectNoSeriousViolations(page)

    await page.click('a:has-text("Users & Roles")')
    await page.waitForSelector('h1:has-text("Users & Roles")')
    await expectNoSeriousViolations(page)
  })
})
