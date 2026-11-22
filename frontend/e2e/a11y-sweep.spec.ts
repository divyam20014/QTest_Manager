import { expect, test, type Browser } from '@playwright/test'

import { axeFindings, formatFindings } from './a11y'
import { loginViaUi } from './fixtures'
import { seedRoleTenant, type RoleTenant } from './roleTenant'

// GAP-22 / ADR-090: the full-impact accessibility gate. axe-core, WCAG 2.0 and
// 2.1 A + AA plus best-practice rules, EVERY impact level (minor and moderate
// included), over the main routes as Admin, Manager and Tester (so the No access
// screens are scanned too), plus the public pages. Throwaway tenant only.
//
// The gate fails on any finding except rules in ALLOW below. ALLOW is the
// explicit, documented allowlist: each entry must also be listed in
// docs/KNOWN_GAPS.md (GAP-22). It is empty because every finding from the
// first full run was fixed at its source.
const ALLOW: Record<string, string> = {}

function routes(t: RoleTenant): string[] {
  const p = t.projectId
  return [
    '/',
    '/projects',
    `/projects/${p}`,
    `/projects/${p}/test-cases`,
    `/projects/${p}/test-runs`,
    `/projects/${p}/requirements`,
    `/projects/${p}/traceability-matrix`,
    `/test-cases/${t.caseId}`,
    `/test-runs/${t.runId}`,
    `/test-run-cases/${t.runCaseId}?runId=${t.runId}`,
    '/test-repository',
    '/test-runs',
    '/execution',
    '/defects',
    `/defects/${t.defectId}`,
    '/reporting',
    '/reporting/print',
    '/admin/users',
    '/admin/roles',
    '/admin/audit-logs',
    '/admin/environments',
    '/settings',
    '/account',
    '/user-guide',
    '/this-route-does-not-exist',
  ]
}

async function scanRoutes(
  browser: Browser,
  t: RoleTenant,
  who: { label: string; email: string; password: string },
  viewport: { width: number; height: number },
  theme: 'light' | 'dark',
  problems: string[],
) {
  const ctx = await browser.newContext({ viewport, colorScheme: theme })
  await ctx.addInitScript((value) => {
    try {
      localStorage.setItem('qtesthub:theme', value)
    } catch {
      /* storage unavailable */
    }
  }, theme)
  const page = await ctx.newPage()
  await loginViaUi(page, t.tenantId, who.email, who.password)
  for (const route of routes(t)) {
    await page.goto(route)
    await page.locator('main').first().waitFor()
    await page.waitForLoadState('networkidle')
    // Let chart animations and lazy chunks settle.
    await page.waitForTimeout(700)
    const label = `${who.label} ${route.replace(/[0-9a-f-]{36}/g, ':id')} @${viewport.width} ${theme}`
    problems.push(...formatFindings(label, await axeFindings(page, ALLOW)))
  }
  await ctx.close()
}

test('signed-in routes have no accessibility findings at any impact level (Admin, Manager, Tester)', async ({
  browser,
  request,
}) => {
  test.setTimeout(1_500_000)
  const t = await seedRoleTenant(request, 'A11ySweep', { withData: true })
  const problems: string[] = []
  const desktop = { width: 1280, height: 800 }
  const phone = { width: 390, height: 844 }
  await scanRoutes(browser, t, { label: 'admin', email: t.adminEmail, password: t.adminPassword }, desktop, 'light', problems)
  await scanRoutes(browser, t, { label: 'manager', email: t.manager.email, password: t.manager.password }, desktop, 'light', problems)
  await scanRoutes(browser, t, { label: 'tester', email: t.tester.email, password: t.tester.password }, desktop, 'light', problems)
  // Dark theme and phone layout (different markup/colour tokens) as Admin.
  await scanRoutes(browser, t, { label: 'admin', email: t.adminEmail, password: t.adminPassword }, phone, 'dark', problems)
  expect(problems, problems.join('\n')).toEqual([])
})

test('public pages have no accessibility findings at any impact level, light and dark', async ({ browser }) => {
  test.setTimeout(300_000)
  const problems: string[] = []
  for (const [viewport, theme] of [
    [{ width: 1280, height: 800 }, 'light'],
    [{ width: 390, height: 844 }, 'dark'],
  ] as const) {
    const ctx = await browser.newContext({ viewport, colorScheme: theme })
    await ctx.addInitScript((value) => {
      try {
        localStorage.setItem('qtesthub:theme', value)
      } catch {
        /* storage unavailable */
      }
    }, theme)
    const page = await ctx.newPage()
    for (const route of ['/login', '/signup', '/platform-admin', '/accept-invite/not-a-token', '/', '/privacy', '/terms']) {
      await page.goto(route)
      await page.waitForLoadState('networkidle')
      // The marketing home reveals sections with a fade/slide; scan once settled.
      await page.waitForTimeout(route === '/' ? 3500 : 600)
      problems.push(...formatFindings(`public ${route} @${viewport.width} ${theme}`, await axeFindings(page, ALLOW)))
    }
    await ctx.close()
  }
  expect(problems, problems.join('\n')).toEqual([])
})
