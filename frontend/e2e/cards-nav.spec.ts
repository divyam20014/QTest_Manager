import { expect, test, type Page } from '@playwright/test'

import { axeFindings, formatFindings } from './a11y'
import { API_BASE_URL, bootstrapTenant, loginViaUi, seedDefectBody, seedCaseBody } from './fixtures'

// ADR-104: interactive summary cards, the phone tab bar (badges, sliding
// indicator, hide-on-scroll) and the collapsed desktop icon rail.
test.setTimeout(120_000)

async function post(page: Page, path: string, data: unknown) {
  const res = await page.request.post(`${API_BASE_URL}${path}`, { data })
  expect(res.ok(), `${path} ${res.status()}`).toBeTruthy()
  return (await res.json()).data
}

async function signIn(page: Page, label: string) {
  const tenant = await bootstrapTenant(page.request, label)
  await loginViaUi(page, tenant.tenantId, tenant.adminEmail, tenant.adminPassword)
}

async function seedProject(page: Page) {
  return post(page, '/projects', {
    name: 'Cards Nav Project',
    domain: 'Motor',
    priority: 'High',
    manager_name: 'Jane Manager',
    start_date: '2026-01-01',
    end_date: '2026-12-31',
    budget: '1000.00',
    region: 'North America',
  })
}

const noOverflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)

test('cards: hover lifts 4px, reduced motion disables it, the card is one link', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await signIn(page, 'CardsNavCards')
  await seedProject(page)
  await page.goto('/')
  const card = page.locator('.qth-card-interactive').first()
  await expect(card).toBeVisible()

  // One link target per card: no nested anchors, padding is 24px on desktop.
  expect(await card.locator('a a').count()).toBe(0)
  const href = await card.locator('a').first().getAttribute('href')
  const box = (await card.boundingBox())!
  expect(await card.evaluate((el) => getComputedStyle(el).paddingLeft)).toBe('24px')
  const corner = { x: box.width - 6, y: box.height - 6 }

  await card.hover({ position: corner })
  await expect.poll(() => card.evaluate((el) => getComputedStyle(el).transform)).toBe('matrix(1, 0, 0, 1, 0, -4)')

  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.mouse.move(0, 0)
  await card.hover({ position: corner })
  expect(await card.evaluate((el) => getComputedStyle(el).transform)).toBe('none')
  await page.emulateMedia({ reducedMotion: 'no-preference' })

  await card.locator('a').first().focus()
  await expect(card.locator('a').first()).toBeFocused()
  await card.click({ position: corner })
  await expect(page).toHaveURL(new RegExp(href!.split('?')[0]))

  await page.goto('/')
  await expect(page.locator('.qth-card-interactive').first()).toBeVisible()
  expect(formatFindings('dashboard', await axeFindings(page))).toEqual([])
})

test('phone tab bar: badge, sliding indicator, hide on scroll, pinned console', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await signIn(page, 'CardsNavPhone')
  const project = await seedProject(page)
  await post(page, '/defects', seedDefectBody(project.id, { title: 'Badge defect' }))
  const tc = await post(page, `/projects/${project.id}/test-cases`, await seedCaseBody(page.request, project.id, {
    title: 'Console case',
    priority: 'High',
    steps: [{ action: 'Do', expected: 'Done' }],
  }))
  await post(page, `/test-cases/${tc.id}/submit-review`, {})
  await post(page, `/test-cases/${tc.id}/approve`, {})
  const run = await post(page, `/projects/${project.id}/test-runs`, {
    name: 'Console Run',
    run_type: 'Regression',
    test_case_ids: [tc.id],
  })

  await page.goto('/')
  const bar = page.getByRole('navigation', { name: 'Primary' })
  const defects = bar.getByRole('link', { name: /^Defects/ })
  await expect(defects).toHaveAccessibleName(/^Defects ?, 1 open$/)
  await expect(defects.getByTestId('tab-badge')).toHaveText('1')

  // Sliding indicator follows the active tab.
  const indicator = bar.getByTestId('tab-indicator')
  await bar.getByRole('link', { name: 'Projects' }).click()
  await expect(page).toHaveURL(/\/projects$/)
  await expect(indicator).toHaveAttribute('data-index', '2')
  const tabBox = (await bar.getByRole('link', { name: 'Projects' }).boundingBox())!
  await expect
    .poll(async () => {
      const b = (await indicator.boundingBox())!
      return Math.abs(b.x + b.width / 2 - (tabBox.x + tabBox.width / 2))
    })
    .toBeLessThan(3)

  // Hide on scroll down, return on scroll up (the dashboard is a long one-column page).
  await page.goto('/')
  await expect(page.locator('.qth-card-interactive').first()).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollHeight - innerHeight)).toBeGreaterThan(200)
  await expect(bar).toHaveAttribute('data-hidden', 'false')
  await page.mouse.move(200, 400)
  await page.mouse.wheel(0, 300)
  await expect(bar).toHaveAttribute('data-hidden', 'true')
  await page.mouse.wheel(0, -60)
  await expect(bar).toHaveAttribute('data-hidden', 'false')

  // Reduced motion: the bar just stays visible.
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.mouse.wheel(0, 300)
  await page.waitForTimeout(300)
  await expect(bar).toHaveAttribute('data-hidden', 'false')
  await page.emulateMedia({ reducedMotion: 'no-preference' })

  // Pinned action bar route: never hides.
  await page.goto(`/test-run-cases/${run.cases[0].id}?runId=${run.id}`)
  await expect(bar).toBeVisible()
  await page.mouse.wheel(0, 600)
  await page.waitForTimeout(300)
  await expect(bar).toHaveAttribute('data-hidden', 'false')

  await page.goto('/')
  await expect(defects).toBeVisible()
  expect(formatFindings('tab bar', await axeFindings(page))).toEqual([])
})

test('icon rail: collapse persists, tooltip on keyboard focus, no overflow', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await signIn(page, 'CardsNavRail')
  await page.goto('/')
  await page.getByRole('button', { name: 'Collapse sidebar' }).click()
  const aside = page.getByRole('complementary', { name: 'Sidebar' })
  await expect.poll(async () => Math.round((await aside.boundingBox())!.width)).toBe(64)
  expect(await noOverflow(page)).toBeLessThanOrEqual(0)

  await page.reload()
  await expect(page.getByRole('button', { name: 'Expand sidebar' })).toBeVisible()
  expect(Math.round((await aside.boundingBox())!.width)).toBe(64)

  await aside.getByRole('link', { name: 'Defects' }).focus()
  await expect(page.getByRole('tooltip')).toHaveText('Defects')
  expect(Math.round((await aside.boundingBox())!.width)).toBe(64)

  expect(formatFindings('rail', await axeFindings(page))).toEqual([])

  await page.setViewportSize({ width: 768, height: 800 })
  expect(await noOverflow(page)).toBeLessThanOrEqual(0)
  await expect(aside).toBeVisible()
})
