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

// Gap-closure pass (GAP-22, ADR-057): the original pass above deliberately
// scoped to serious/critical only. This widens the same scans to also fail
// on minor/moderate findings, closing that gap -- but this is still an
// automated axe-core scan, not a certification-grade manual audit (full
// keyboard-only navigation, screen-reader narration quality, focus-order
// review remain separate, genuinely manual work no automated pass
// substitutes for).
async function expectNoViolationsOfAnyImpact(page: import('@playwright/test').Page) {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()
  expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([])
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

  // SAAS-GAP-12: the pages this session's enterprise redesign added or
  // substantially reworked had zero accessibility coverage -- every page
  // below is new or materially changed since the original 5-page scan
  // above was written.
  test('Test Repository, Test Runs, Execution Console, Audit Logs, Settings have no serious violations', async ({
    page,
    request,
  }) => {
    const tenant = await bootstrapTenant(request, 'A11yRedesign')
    await loginViaUi(page, tenant.tenantId, tenant.adminEmail, tenant.adminPassword)

    await page.click('a:has-text("Test Repository")')
    await page.waitForSelector('h1:has-text("Test Repository")')
    await page.waitForTimeout(500) // let the per-project queries settle
    await expectNoSeriousViolations(page)

    await page.click('a:has-text("Test Runs")')
    await page.waitForSelector('h1:has-text("Test Runs")')
    await page.waitForTimeout(500)
    await expectNoSeriousViolations(page)

    await page.click('a:has-text("Execution Console")')
    await page.waitForSelector('text=Active Executions')
    await page.waitForTimeout(500)
    await expectNoSeriousViolations(page)

    await page.click('a:has-text("Audit Logs")')
    await page.waitForSelector('h1:has-text("Audit Logs")')
    await expectNoSeriousViolations(page)

    await page.click('a:has-text("Settings")')
    await page.waitForSelector('text=Organization Settings')
    await expectNoSeriousViolations(page)
  })

  // GAP-22 widening: same pages, all impact levels (not just serious/critical).
  test('Core pages have no violations at any impact level', async ({ page, request }) => {
    const tenant = await bootstrapTenant(request, 'A11yFull')
    await loginViaUi(page, tenant.tenantId, tenant.adminEmail, tenant.adminPassword)
    await expectNoViolationsOfAnyImpact(page)

    await page.click('a:has-text("Projects")')
    await page.waitForSelector('h1:has-text("Projects")')
    await expectNoViolationsOfAnyImpact(page)

    await page.click('a:has-text("Defects")')
    await page.waitForSelector('h1:has-text("Defects")')
    await expectNoViolationsOfAnyImpact(page)

    await page.click('a:has-text("Test Repository")')
    await page.waitForSelector('h1:has-text("Test Repository")')
    await page.waitForTimeout(500)
    await expectNoViolationsOfAnyImpact(page)

    await page.click('a:has-text("Audit Logs")')
    await page.waitForSelector('h1:has-text("Audit Logs")')
    await expectNoViolationsOfAnyImpact(page)

    await page.click('a:has-text("Settings")')
    await page.waitForSelector('text=Organization Settings')
    await expectNoViolationsOfAnyImpact(page)
  })
})
