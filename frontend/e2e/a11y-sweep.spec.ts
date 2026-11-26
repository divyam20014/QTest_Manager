import { expect, test, type Browser } from '@playwright/test'

import { axeFindings, formatFindings, settle, smallTargets } from './a11y'
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
    `/projects/${p}/traceability-matrix`,
    // ADR-127: records open inside their project.
    `/projects/${p}/test-cases/${t.caseId}`,
    `/projects/${p}/test-runs/${t.runId}`,
    `/projects/${p}/requirements/${t.requirementId}`,
    `/test-run-cases/${t.runCaseId}?runId=${t.runId}`,
    // ADR-127: tasks, sub-tasks and their screens.
    `/projects/${p}/tasks`,
    `/projects/${p}/tasks?view=board`,
    `/projects/${p}/tasks?view=flat`,
    // ADR-128: the New Requirement dialog, open (Testers lack the permission and see the page alone).
    `/projects/${p}/tasks?action=new-requirement`,
    `/projects/${p}/tasks/${t.taskId}`,
    `/projects/${p}/tasks/${t.subTaskId}`,
    `/projects/${p}/traceability-matrix?task=${t.taskId}&sub=1`,
    '/admin/task-statuses',
    // ADR-126: the workspace redesign (My Work, the moved project tabs, board and calendar views).
    '/my-work',
    `/projects/${p}/test-plans`,
    `/projects/${p}/releases`,
    `/projects/${p}/team`,
    `/projects/${p}/activity`,
    `/projects/${p}/settings`,
    `/defects?projectId=${p}&view=board`,
    `/projects/${p}/test-cases?view=board`,
    `/projects/${p}/test-runs?view=board`,
    `/projects/${p}/test-runs?view=calendar`,
    '/admin/workspace',
    '/test-repository',
    '/test-runs',
    '/execution',
    '/defects',
    `/projects/${p}/defects/${t.defectId}`,
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
    // Let chart animations, lazy chunks and any fading overlay settle.
    await settle(page)
    await page.waitForTimeout(400)
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

// ADR-126 (phase 7): the new workspace pages at every breakpoint and in both themes, as every role.
// axe at every impact level, no sideways scroll, no interactive target under 24 px (WCAG 2.5.8) and,
// on a phone, a report of anything under 44 px. A Tester and a Manager get the No access screen on
// /admin/workspace; that screen is scanned too.
const NEW_PAGES = (p: string) => [
  '/my-work',
  `/projects/${p}`,
  `/projects/${p}/test-plans`,
  `/projects/${p}/team`,
  `/projects/${p}/settings`,
  `/defects?projectId=${p}&view=board`,
  `/projects/${p}/test-cases?view=board`,
  `/projects/${p}/test-runs?view=board`,
  `/projects/${p}/test-runs?view=calendar`,
  '/admin/workspace',
  // ADR-127: the task screens.
  `/projects/${p}/tasks`,
  `/projects/${p}/tasks?view=board`,
  '/admin/task-statuses',
]
const BREAKPOINTS = [
  { width: 1440, height: 900, theme: 'light' },
  { width: 1280, height: 800, theme: 'dark' },
  { width: 768, height: 1024, theme: 'light' },
  { width: 375, height: 812, theme: 'dark' },
  { width: 375, height: 812, theme: 'light' },
] as const

test('workspace pages: axe and overflow (tap targets reported) at 1440 / 1280 / 768 / 375, light and dark, every role', async ({
  browser,
  request,
}, testInfo) => {
  test.setTimeout(2_400_000)
  const t = await seedRoleTenant(request, 'WsA11y', { withData: true })
  const problems: string[] = []
  const phoneSmall: string[] = []
  const small24: string[] = []
  const people = [
    { label: 'admin', email: t.adminEmail, password: t.adminPassword },
    { label: 'manager', email: t.manager.email, password: t.manager.password },
    { label: 'tester', email: t.tester.email, password: t.tester.password },
  ]
  for (const who of people) {
    for (const bp of BREAKPOINTS) {
      const ctx = await browser.newContext({ viewport: { width: bp.width, height: bp.height }, colorScheme: bp.theme })
      await ctx.addInitScript((value) => {
        try {
          localStorage.setItem('qtesthub:theme', value)
        } catch {
          /* storage unavailable */
        }
      }, bp.theme)
      const page = await ctx.newPage()
      await loginViaUi(page, t.tenantId, who.email, who.password)
      for (const route of [...NEW_PAGES(t.projectId!), `/projects/${t.projectId}/tasks/${t.taskId}`]) {
        await page.goto(route)
        await page.locator('main').first().waitFor()
        await page.waitForLoadState('networkidle')
        await settle(page)
        await page.waitForTimeout(400)
        const label = `${who.label} ${route.replace(/[0-9a-f-]{36}/g, ':id')} @${bp.width} ${bp.theme}`
        problems.push(...formatFindings(label, await axeFindings(page)))
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
        if (overflow > 0) problems.push(`${label}: horizontal overflow ${overflow}px`)
        for (const s of await smallTargets(page, 24)) small24.push(`${route.replace(/[0-9a-f-]{36}/g, ':id')} @${bp.width}: ${s.label} ${s.width}x${s.height}`)
        if (bp.width <= 375 && bp.theme === 'light') {
          for (const s of await smallTargets(page, 44)) phoneSmall.push(`${label}: ${s.label} ${s.width}x${s.height}`)
        }
      }
      await ctx.close()
    }
  }
  await testInfo.attach('phone-targets-under-44', { body: [...new Set(phoneSmall)].join('\n'), contentType: 'text/plain' })
  // WCAG 2.2 target size (2.5.8) is beyond the WCAG 2.1 AA gate this suite enforces: reported, not failed.
  await testInfo.attach('targets-under-24', { body: [...new Set(small24)].join('\n'), contentType: 'text/plain' })
  console.log(`TARGETS UNDER 24PX (${small24.length}):\n${[...new Set(small24)].join('\n')}`)
  console.log(`PHONE TARGETS UNDER 44PX (${phoneSmall.length}):\n${[...new Set(phoneSmall)].join('\n')}`)
  expect(problems, problems.join('\n')).toEqual([])
})
