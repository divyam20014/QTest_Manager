import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'

import { API_BASE_URL, bootstrapTenant, loginViaUi, seedDefectBody, seedCaseBody } from './fixtures'

// BRD gap Phase 3: accessibility (axe WCAG 2 A/AA), horizontal overflow and
// phone tap-target sweep over the screens added or changed in BRD Phases 1-3,
// at phone / tablet / desktop widths in light and dark. Throwaway tenant only.

async function post(page: Page, path: string, data?: unknown) {
  const response = await page.request.post(`${API_BASE_URL}${path}`, { data })
  if (!response.ok()) throw new Error(`POST ${path} failed (${response.status()}): ${await response.text()}`)
  return (await response.json()).data
}

async function get(page: Page, path: string) {
  const response = await page.request.get(`${API_BASE_URL}${path}`)
  if (!response.ok()) throw new Error(`GET ${path} failed (${response.status()}): ${await response.text()}`)
  return (await response.json()).data
}

const WIDTHS = [
  { name: 'phone', width: 390, height: 844 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'desktop', width: 1280, height: 800 },
]

test('Phase 1-3 screens: axe, overflow and phone tap targets in light and dark', async ({ page, request }) => {
  test.setTimeout(600_000)
  const tenant = await bootstrapTenant(request, 'BrdSweep3')
  await loginViaUi(page, tenant.tenantId, tenant.adminEmail, tenant.adminPassword)

  const me = (await get(page, '/auth/me')) as { user_id: string }
  const project = await post(page, '/projects', {
    name: 'Apex Motor Claims',
    domain: 'Motor',
    priority: 'High',
    manager_name: 'Jane Manager',
    start_date: '2026-01-01',
    end_date: '2026-12-31',
    budget: '450000.00',
    region: 'North America',
  })
  if (!project.assigned_user_ids.includes(me.user_id)) {
    await post(page, `/projects/${project.id}/members`, { user_id: me.user_id })
  }
  const caseIds: string[] = []
  for (const title of ['Verify total loss settlement', 'Reject a duplicate claim', 'Apply salvage valuation']) {
    const created = await post(page, `/projects/${project.id}/test-cases`, await seedCaseBody(page.request, project.id, {
      title,
      priority: 'High',
      steps: [
        { action: `Do step 1 of ${title}`, expected: 'Works' },
        { action: `Do step 2 of ${title}`, expected: 'Works' },
      ],
    }))
    await post(page, `/test-cases/${created.id}/submit-review`, {})
    await post(page, `/test-cases/${created.id}/approve`)
    caseIds.push(created.id)
  }
  const run = await post(page, `/projects/${project.id}/test-runs`, {
    name: 'Sweep Run',
    run_type: 'Regression',
    test_case_ids: caseIds,
  })
  const [first, second] = run.cases
  const firstSteps = await get(page, `/test-run-cases/${first.id}/steps`)
  await post(page, `/execution-steps/${firstSteps[0].id}/verdict`, { verdict: 'fail', actual_result: 'The step failed' })
  const defect = await post(page, '/defects', seedDefectBody(undefined, { execution_step_id: firstSteps[0].id }))
  await post(page, `/test-run-cases/${second.id}/block`, { reason: 'Test environment is down' })

  const routes: { name: string; path: string }[] = [
    { name: 'dashboard', path: '/' },
    { name: 'projects', path: '/projects' },
    { name: 'project-detail', path: `/projects/${project.id}` },
    { name: 'reporting', path: '/reporting' },
    { name: 'test-repository', path: '/test-repository' },
    { name: 'test-cases', path: `/projects/${project.id}/test-cases` },
    { name: 'defects', path: '/defects' },
    { name: 'defect-detail', path: `/defects/${defect.id}` },
    { name: 'test-run-detail', path: `/test-runs/${run.id}` },
    { name: 'execution-console', path: `/test-run-cases/${second.id}?runId=${run.id}` },
    { name: 'traceability', path: `/projects/${project.id}/traceability-matrix` },
  ]

  const problems: string[] = []
  for (const theme of ['light', 'dark'] as const) {
    await page.addInitScript((t) => {
      try {
        localStorage.setItem('qtesthub:theme', t)
      } catch {
        // storage unavailable: theme stays default
      }
    }, theme)
    for (const vp of WIDTHS) {
      await page.setViewportSize({ width: vp.width, height: vp.height })
      for (const route of routes) {
        const label = `${route.name} @${vp.name} ${theme}`
        const consoleErrors: string[] = []
        const onConsole = (m: import('@playwright/test').ConsoleMessage) => {
          if (m.type() === 'error') consoleErrors.push(m.text())
        }
        page.on('console', onConsole)
        await page.goto(route.path)
        await page.locator('main').waitFor()
        await page.waitForLoadState('networkidle')
        // Let chart animations and lazy chunks settle.
        await page.waitForTimeout(700)
        await page.evaluate((t) => {
          document.documentElement.dataset.theme = t
        }, theme)

        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        )
        if (overflow > 1) problems.push(`${label}: horizontal overflow ${overflow}px`)

        const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()
        for (const v of axe.violations) {
          problems.push(`${label}: axe ${v.id} (${v.impact}) x${v.nodes.length}: ${v.nodes[0]?.target.join(' ')}`)
        }

        if (vp.name === 'phone') {
          const small = await page.evaluate(() => {
            const out: string[] = []
            const nodes = document.querySelectorAll<HTMLElement>('a[href], button, input, select, textarea, [role="tab"], [role="button"]')
            for (const el of nodes) {
              const rect = el.getBoundingClientRect()
              const style = getComputedStyle(el)
              if (rect.width === 0 || rect.height === 0 || style.visibility === 'hidden') continue
              if (el.closest('[aria-hidden="true"]')) continue
              // Skip link (off-screen until focused) and links stretched over a
              // whole card (the card itself is the tap target).
              if (el.textContent?.trim() === 'Skip to main content') continue
              if (el.matches('a') && (el.querySelector('span.absolute, .absolute.inset-0') || getComputedStyle(el, '::after').position === 'absolute')) continue
              if (style.position === 'absolute' && rect.width > 200) continue
              if (el instanceof HTMLInputElement && (el.type === 'checkbox' || el.type === 'radio')) {
                const wrapper = el.closest('label')?.getBoundingClientRect()
                if (wrapper && wrapper.height >= 44) continue
              }
              // Inline text links inside a paragraph are exempt (WCAG 2.5.8).
              if (el.matches('a') && el.closest('p, li, dd') && style.display === 'inline') continue
              if (rect.height < 43.5 || rect.width < 43.5) {
                out.push(`${el.tagName.toLowerCase()} "${(el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 40)}" ${Math.round(rect.width)}x${Math.round(rect.height)}`)
              }
            }
            return out
          })
          for (const s of small.slice(0, 6)) problems.push(`${label}: tap target ${s}`)
        }
        page.off('console', onConsole)
        const real = consoleErrors.filter((e) => !/favicon|Failed to load resource: the server responded with a status of 40[134]/.test(e))
        if (real.length) problems.push(`${label}: console error ${real[0].slice(0, 120)}`)
      }
    }
  }

  // eslint-disable-next-line no-console
  console.log(`SWEEP PROBLEMS (${problems.length}):\n` + problems.join('\n'))
  expect(problems).toEqual([])
})
