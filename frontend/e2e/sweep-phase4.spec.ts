import AxeBuilder from '@axe-core/playwright'
import { expect, test, type ConsoleMessage, type Page } from '@playwright/test'

import {
  bootstrapTenant,
  freshPlatformTotpCode,
  loginViaUi,
  PLATFORM_ADMIN_EMAIL,
  PLATFORM_ADMIN_PASSWORD,
} from './fixtures'

// BRD gap Phase 4: accessibility (axe WCAG 2 A/AA), horizontal overflow and
// phone tap-target sweep over the Documentation viewer, Sign-up, Settings and
// the New Project dialog, at phone / tablet / desktop widths in light and dark.
// Throwaway tenant only.

const WIDTHS = [
  { name: 'phone', width: 390, height: 844 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'desktop', width: 1280, height: 800 },
]

async function checkPage(page: Page, label: string, phone: boolean, problems: string[], consoleErrors: string[]) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
  if (overflow > 1) problems.push(`${label}: horizontal overflow ${overflow}px`)

  const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()
  for (const v of axe.violations) {
    problems.push(`${label}: axe ${v.id} (${v.impact}) x${v.nodes.length}: ${v.nodes[0]?.target.join(' ')}`)
  }

  if (phone) {
    const small = await page.evaluate(() => {
      const out: string[] = []
      const nodes = document.querySelectorAll<HTMLElement>(
        'a[href], button, input, select, textarea, summary, [role="tab"], [role="button"]',
      )
      for (const el of nodes) {
        const rect = el.getBoundingClientRect()
        const style = getComputedStyle(el)
        if (rect.width === 0 || rect.height === 0 || style.visibility === 'hidden') continue
        if (el.closest('[aria-hidden="true"]')) continue
        if (el.textContent?.trim() === 'Skip to main content') continue
        // Links inside rendered document prose are inline text links (exempt, WCAG 2.5.8).
        if (el.matches('a') && el.closest('article, p, li, dd') && style.display === 'inline') continue
        // Diagram internals are an image, not controls.
        if (el.closest('.brd-diagram-canvas')) continue
        if (el instanceof HTMLInputElement && (el.type === 'checkbox' || el.type === 'radio')) {
          const wrapper = el.closest('label')?.getBoundingClientRect()
          if (wrapper && wrapper.height >= 44) continue
        }
        if (rect.height < 43.5 || rect.width < 43.5) {
          out.push(
            `${el.tagName.toLowerCase()} "${(el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 40)}" ${Math.round(rect.width)}x${Math.round(rect.height)}`,
          )
        }
      }
      return out
    })
    for (const s of small.slice(0, 6)) problems.push(`${label}: tap target ${s}`)
  }
  // The app's own "who am I" check logs a 401 on every signed-out page; that
  // is expected there (same on Login) and is not a defect.
  const real = consoleErrors.filter(
    (e) =>
      !/favicon|Failed to load resource: the server responded with a status of 40[134]/.test(e) &&
      !(label.startsWith('signup') && /API GET \/auth\/me failed \(401\)/.test(e)),
  )
  if (real.length) problems.push(`${label}: console error ${real[0].slice(0, 120)}`)
}

test('Phase 4 screens: axe, overflow and phone tap targets in light and dark', async ({ page, request }) => {
  test.setTimeout(900_000)
  const tenant = await bootstrapTenant(request, 'BrdSweep4')

  const problems: string[] = []
  for (const theme of ['light', 'dark'] as const) {
    await page.addInitScript((t) => {
      try {
        localStorage.setItem('qtesthub:theme', t)
      } catch {
        // storage unavailable: theme stays default
      }
    }, theme)

    // ---- Sign-up (public, signed out) -- first pass of each theme only.
    if (theme === 'light') {
      await page.context().clearCookies()
    }
    for (const vp of WIDTHS) {
      await page.setViewportSize({ width: vp.width, height: vp.height })
      const label = `signup @${vp.name} ${theme}`
      const errors: string[] = []
      const onConsole = (m: ConsoleMessage) => {
        if (m.type() === 'error') errors.push(m.text())
      }
      page.on('console', onConsole)
      await page.goto('/signup')
      await page.getByLabel(/Insurance Domain/).waitFor()
      await page.evaluate((t) => {
        document.documentElement.dataset.theme = t
      }, theme)
      await checkPage(page, label, vp.name === 'phone', problems, errors)
      page.off('console', onConsole)
    }

    // ---- Signed in screens.
    await loginViaUi(page, tenant.tenantId, tenant.adminEmail, tenant.adminPassword)
    const routes: { name: string; path: string; wait: string }[] = [
      { name: 'docs-user-guide', path: '/brd/user-guide', wait: 'article h1' },
      { name: 'docs-api-spec', path: '/brd/api-specification', wait: 'article h1' },
      { name: 'docs-db-schema', path: '/brd/database-schema', wait: 'article h1' },
      { name: 'docs-sequence', path: '/brd/sequence-diagrams', wait: 'figure.brd-diagram[data-state="ready"]' },
      { name: 'docs-system-arch', path: '/brd/system-architecture', wait: 'figure.brd-diagram[data-state="ready"]' },
      { name: 'settings', path: '/settings', wait: '#primary-domain' },
      { name: 'projects', path: '/projects', wait: 'main' },
    ]
    for (const vp of WIDTHS) {
      await page.setViewportSize({ width: vp.width, height: vp.height })
      for (const route of routes) {
        const label = `${route.name} @${vp.name} ${theme}`
        const errors: string[] = []
        const onConsole = (m: ConsoleMessage) => {
          if (m.type() === 'error') errors.push(m.text())
        }
        page.on('console', onConsole)
        await page.goto(route.path)
        await page.locator(route.wait).first().waitFor({ timeout: 60_000 })
        await page.waitForLoadState('networkidle')
        await page.waitForTimeout(500)
        await page.evaluate((t) => {
          document.documentElement.dataset.theme = t
        }, theme)
        await checkPage(page, label, vp.name === 'phone', problems, errors)
        page.off('console', onConsole)
      }
      // New Project dialog with the pre-selected domain.
      {
        const label = `new-project-dialog @${vp.name} ${theme}`
        const errors: string[] = []
        const onConsole = (m: ConsoleMessage) => {
          if (m.type() === 'error') errors.push(m.text())
        }
        page.on('console', onConsole)
        await page.goto('/projects')
        await page.getByRole('button', { name: /New Project/ }).click()
        await page.getByRole('dialog').waitFor()
        await page.waitForTimeout(400)
        await checkPage(page, label, vp.name === 'phone', problems, errors)
        await page.keyboard.press('Escape')
        page.off('console', onConsole)
      }
    }
    // Sign out between themes so the next theme starts clean.
    await page.context().clearCookies()
  }

  // eslint-disable-next-line no-console
  console.log(`SWEEP PROBLEMS (${problems.length}):\n` + problems.join('\n'))
  expect(problems).toEqual([])
})

// ---------------------------------------------------------------------------
// Role visibility on the seeded Meridian demo tenant: READ-ONLY (sign in, open
// pages, read what is shown; nothing is changed).

const DEMO = {
  admin: { email: 'admin@meridianauto.demo', password: 'DemoAdmin!2026' },
  manager: { email: 'elena.vasquez@meridianauto.demo', password: 'DemoTeam!2026' },
  tester: { email: 'aisha.okafor@meridianauto.demo', password: 'DemoTeam!2026' },
}

for (const role of ['admin', 'manager', 'tester'] as const) {
  test(`Demo tenant (read-only): ${role} sees the right documents and the Documentation entry`, async ({ page }) => {
    await loginViaUi(page, '', DEMO[role].email, DEMO[role].password)
    await page.goto('/brd')
    await expect(page).toHaveURL(/\/brd\/user-guide$/)
    await expect(page.locator('article h1').first()).toContainText('User Guide')
    await expect(page.getByRole('navigation').getByRole('link', { name: 'Documentation' }).first()).toBeVisible()
    const docsNav = page.getByRole('navigation', { name: 'Documents' })
    const count = await docsNav.getByRole('link').count()
    // ADR-089: Admin sees all 24 documents; Manager and Tester only the 12 general ones.
    if (role !== 'admin') {
      expect(count).toBe(12)
      await page.goto('/brd/api-specification')
      await expect(page.getByRole('heading', { name: /don.t have access/i })).toBeVisible()
    } else {
      expect(count).toBe(24)
      await page.goto('/brd/api-specification')
      await expect(page.locator('article h1').first()).toContainText('API Specification')
    }
  })
}

test('Platform Admin: the tenant list shows an Insurance Domain column and the New Tenant dialog offers it', async ({
  page,
}) => {
  await page.goto('/platform-admin')
  await page.getByLabel('Email').fill(PLATFORM_ADMIN_EMAIL)
  await page.getByLabel('Password').fill(PLATFORM_ADMIN_PASSWORD)
  await page.getByRole('button', { name: 'Sign in' }).click()
  // ADR-074: second step -- 6-digit authenticator code.
  await page.getByLabel('Authentication code').fill(await freshPlatformTotpCode())
  await page.getByRole('button', { name: 'Verify' }).click()
  await expect(page.getByRole('columnheader', { name: 'Domain' })).toBeVisible({ timeout: 30_000 })
  await page.getByRole('button', { name: 'New Tenant' }).click()
  const select = page.getByLabel('Insurance Domain (optional)')
  await expect(select).toBeVisible()
  expect(await select.locator('option').allTextContents()).toEqual([
    'Not specified',
    'Motor',
    'Health',
    'Travel',
    'Life',
    'Property',
    'Other / multiple',
  ])
})
