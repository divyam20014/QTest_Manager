import { expect, test, type Page } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

import { axeFindings, formatFindings } from './a11y'
import { API_BASE_URL, bootstrapTenant, loginViaUi } from './fixtures'

// Issue 45 (ADR-094): opt-in dark cockpit mode on the Execution Console.
// Throwaway tenant; the Admin seeds project, cases and run through the API.

const SHOTS = process.env.E2E_SHOTS_DIR
if (SHOTS) mkdirSync(SHOTS, { recursive: true })

async function post(page: Page, path: string, data?: unknown) {
  const response = await page.request.post(`${API_BASE_URL}${path}`, { data })
  if (!response.ok()) throw new Error(`POST ${path} failed (${response.status()}): ${await response.text()}`)
  return (await response.json()).data
}

function luminance(rgb: string): number {
  const [r, g, b] = rgb.match(/[\d.]+/g)!.slice(0, 3).map(Number)
  const f = (v: number) => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
}

function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)]
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
}

async function seed(page: Page, request: Parameters<typeof bootstrapTenant>[0]) {
  const tenant = await bootstrapTenant(request, 'Cockpit')
  await loginViaUi(page, tenant.tenantId, tenant.adminEmail, tenant.adminPassword)
  const me = (await (await page.request.get(`${API_BASE_URL}/auth/me`)).json()).data as { user_id: string }
  const project = await post(page, '/projects', {
    name: 'Cockpit Motor Claims',
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
  for (const title of ['Verify salvage valuation', 'Verify total loss settlement']) {
    const created = await post(page, `/projects/${project.id}/test-cases`, {
      title,
      priority: 'High',
      steps: [
        { action: `Open ${title}`, expected: 'It opens' },
        { action: 'Review the figures', expected: 'They match' },
      ],
    })
    await post(page, `/test-cases/${created.id}/submit-review`, {})
    await post(page, `/test-cases/${created.id}/approve`)
    caseIds.push(created.id)
  }
  const run = await post(page, `/projects/${project.id}/test-runs`, {
    name: 'Cockpit Run',
    run_type: 'Regression',
    test_case_ids: caseIds,
  })
  return { url: `/test-run-cases/${run.cases[0].id}?runId=${run.id}` }
}

const toggle = (page: Page) => page.getByRole('button', { name: 'Cockpit mode' })
const bg = (page: Page) =>
  page.locator('.cockpit').evaluate((el) => getComputedStyle(el).backgroundColor)

test.describe('cockpit mode', () => {
  test.describe.configure({ mode: 'serial' })

  test('default off, toggle on/off, persists, dark tokens, big buttons, print light', async ({ page, request }) => {
    const { url } = await seed(page, request)
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.goto(url)
    await expect(page.getByRole('group', { name: 'Record a verdict for the current step' })).toBeVisible()

    // Default off: today's console, no class.
    await expect(toggle(page)).toHaveAttribute('aria-pressed', 'false')
    await expect(page.locator('.cockpit')).toHaveCount(0)
    const passOff = await page.getByRole('button', { name: /^Pass/ }).boundingBox()
    if (SHOTS) await page.screenshot({ path: join(SHOTS, 'console-off-1280.png') })

    await toggle(page).click()
    await expect(toggle(page)).toHaveAttribute('aria-pressed', 'true')
    await expect(page.locator('.cockpit')).toHaveCount(1)
    expect(luminance(await bg(page))).toBeLessThan(0.05)
    const tokens = await page.locator('.cockpit').evaluate((el) => {
      const s = getComputedStyle(el)
      return { fg: s.getPropertyValue('--foreground').trim(), bg: s.getPropertyValue('--background').trim() }
    })
    expect(tokens).toEqual({ fg: '#e8edf5', bg: '#0b1018' })
    for (const name of [/^Pass/, /^Fail/, /^Ignore/, /^Block/]) {
      const box = await page.getByRole('group', { name: 'Record a verdict for the current step' }).getByRole('button', { name }).boundingBox()
      expect(box!.height).toBeGreaterThanOrEqual(56)
    }
    expect(passOff!.height).toBeLessThan(56)
    // Timer / state always in view in the header.
    await expect(page.getByText(/elapsed/)).toBeVisible()
    await expect(page.getByText(/Step 1 of 2/)).toBeVisible()
    if (SHOTS) await page.screenshot({ path: join(SHOTS, 'console-on-1280.png') })

    // Computed contrast of the key text pairs on the cockpit surfaces.
    const pairs = await page.evaluate(() => {
      const get = (sel: string) => {
        const el = document.querySelector(sel) as HTMLElement
        const s = getComputedStyle(el)
        return { color: s.color, bg: getComputedStyle(el.closest('.cockpit-panel') ?? el).backgroundColor }
      }
      return [get('h1'), get('.cockpit-statusbar')]
    })
    for (const p of pairs) expect(contrast(p.color, p.bg)).toBeGreaterThanOrEqual(4.5)

    // Persists across reload; independent of app theme.
    await page.reload()
    await expect(toggle(page)).toHaveAttribute('aria-pressed', 'true')
    await expect(page.locator('.cockpit')).toHaveCount(1)

    // Print stays light.
    await page.emulateMedia({ media: 'print' })
    expect(luminance(await bg(page))).toBeGreaterThan(0.9)
    const printFg = await page.locator('.cockpit').evaluate((el) => getComputedStyle(el).color)
    expect(luminance(printFg)).toBeLessThan(0.1)
    await page.emulateMedia({ media: 'screen' })

    // Dark app theme: cockpit tokens still apply (not an automatic flip).
    await page.emulateMedia({ colorScheme: 'dark' })
    expect(luminance(await bg(page))).toBeLessThan(0.05)
    await page.emulateMedia({ colorScheme: 'light' })

    // Toggle off restores the console and the preference.
    await toggle(page).click()
    await expect(page.locator('.cockpit')).toHaveCount(0)
    await page.reload()
    await expect(toggle(page)).toHaveAttribute('aria-pressed', 'false')
  })

  for (const width of [390, 1280]) {
    test(`axe + no overflow with cockpit on at ${width}px`, async ({ page, request }) => {
      const { url } = await seed(page, request)
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 })
      await page.goto(url)
      await toggle(page).click()
      await expect(page.locator('.cockpit')).toHaveCount(1)
      await expect(page.getByText(/elapsed/)).toBeVisible()
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      )
      expect(overflow).toBeLessThanOrEqual(0)
      const minHeight = width === 390 ? 44 : 56
      const box = await page.getByRole('group', { name: 'Record a verdict for the current step' }).getByRole('button', { name: /^Pass/ }).boundingBox()
      expect(box!.height).toBeGreaterThanOrEqual(minHeight)
      // Every verdict button stays inside its bar (no clipped Block button).
      const group = page.getByRole('group', { name: 'Record a verdict for the current step' })
      const gb = (await group.boundingBox())!
      for (const name of [/^Pass/, /^Fail/, /^Ignore/, /^Block/]) {
        const b = (await group.getByRole('button', { name }).boundingBox())!
        expect(b.x + b.width).toBeLessThanOrEqual(gb.x + gb.width + 1)
      }
      expect(formatFindings(`cockpit@${width}`, await axeFindings(page))).toEqual([])
      if (SHOTS) {
        await page.screenshot({ path: join(SHOTS, `console-on-${width}.png`) })
        await toggle(page).click()
        await page.screenshot({ path: join(SHOTS, `console-off-${width}.png`) })
      }
    })
  }
})
