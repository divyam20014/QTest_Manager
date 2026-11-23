import { expect, test, type Page } from '@playwright/test'

import { axeFindings, formatFindings } from './a11y'
import { bootstrapTenant, loginViaUi } from './fixtures'

// ADR-100: colour themes, the Appearance picker, the custom palette and the
// shared dialog polish. One throwaway tenant for the whole file.

const PRESETS = [
  ['cobalt', 'Cobalt & Sunshine'],
  ['sage', 'Sage & Tangerine'],
  ['indigo', 'Indigo & Aqua'],
] as const

let admin: { tenantId: string; adminEmail: string; adminPassword: string }

test.beforeAll(async ({ request }) => {
  admin = await bootstrapTenant(request, 'Themes')
})

async function signIn(page: Page) {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await loginViaUi(page, admin.tenantId, admin.adminEmail, admin.adminPassword)
}

async function openAppearance(page: Page) {
  // ADR-121: Appearance lives in the account menu on desktop and in the More sheet on phones.
  const account = page.getByRole('button', { name: /account menu$/ })
  const more = page.getByRole('button', { name: 'More' })
  await expect(account.or(more)).toBeVisible()
  await (await account.isVisible() ? account : more).click()
  await page.getByRole('button', { name: 'Appearance' }).first().click()
  await expect(page.getByRole('dialog', { name: 'Appearance' })).toBeVisible()
}

const themeAttr = (page: Page) => page.evaluate(() => document.documentElement.dataset.theme)
const cssVar = (page: Page, name: string) =>
  page.evaluate((n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim(), name)

test('presets apply instantly, persist across reload and reach the public login page without a flash', async ({
  page,
}) => {
  await signIn(page)
  await openAppearance(page)
  const radios = page.getByRole('radiogroup', { name: 'Colour theme' }).getByRole('radio')
  await expect(radios).toHaveCount(7)

  const primaries = new Set<string>()
  for (const [id, label] of PRESETS) {
    await page.getByRole('radio', { name: label }).click()
    await expect(page.locator('html')).toHaveAttribute('data-theme', id)
    await expect(page.getByRole('radio', { name: label })).toHaveAttribute('aria-checked', 'true')
    primaries.add(await cssVar(page, '--primary'))
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme)).toBe(
      id === 'sage' ? 'dark' : 'light',
    )
  }
  expect(primaries.size).toBe(3)

  // Arrow keys move and select within the radiogroup.
  await page.getByRole('radio', { name: 'Indigo & Aqua' }).focus()
  await page.keyboard.press('ArrowRight')
  await expect(page.getByRole('radio', { name: 'Custom' })).toHaveAttribute('aria-checked', 'true')
  await page.keyboard.press('ArrowLeft')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'indigo')

  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'indigo')

  // Public page: the attribute is set by theme-init.js before React renders anything.
  await page.addInitScript(() => {
    const w = window as unknown as { __themeProbe?: { theme: string | undefined; rootChildren: number } }
    new MutationObserver((_, obs) => {
      const t = document.documentElement.dataset.theme
      if (t && !w.__themeProbe) {
        w.__themeProbe = { theme: t, rootChildren: document.getElementById('root')?.childElementCount ?? 0 }
        obs.disconnect()
      }
    }).observe(document, { attributes: true, subtree: true, attributeFilter: ['data-theme'] })
  })
  await page.goto('/login')
  const probe = await page.evaluate(
    () => (window as unknown as { __themeProbe?: { theme: string; rootChildren: number } }).__themeProbe,
  )
  expect(probe).toEqual({ theme: 'indigo', rootChildren: 0 })
})

test('custom theme: an extreme colour is corrected and the AA badge shows', async ({ page }) => {
  await signIn(page)
  await openAppearance(page)
  await page.getByRole('radio', { name: 'Custom' }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'custom')
  await expect(page.getByRole('heading', { name: 'Create your theme' })).toBeVisible()

  await page.getByLabel('Primary colour hex').fill('#ffff00')
  const badge = page.getByTestId('contrast-badge')
  await expect(badge).toContainText('AA pass')
  await expect(badge).toContainText('Primary was darkened')
  expect(await cssVar(page, '--primary')).not.toBe('#ffff00')
  expect(await cssVar(page, '--primary-foreground')).toMatch(/^#/)

  await page.getByLabel('Theme name').fill('Lemon')
  await page.locator('label', { has: page.locator('input[name="qth-custom-base"]') }).filter({ hasText: 'dark' }).click()
  await expect(page.getByRole('radio', { name: 'Lemon' })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.style.colorScheme)).toBe('dark')

  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'custom')
  expect(await page.evaluate(() => document.documentElement.style.colorScheme)).toBe('dark')
})

for (const width of [390, 1280]) {
  test(`dialog has padding and 44px actions at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 800 })
    await signIn(page)
    await openAppearance(page)
    const dialog = page.getByRole('dialog', { name: 'Appearance' })
    const body = await dialog.evaluate((el) => {
      const scroller = el.querySelector('.overflow-y-auto') as HTMLElement
      const cs = getComputedStyle(scroller)
      return { left: parseFloat(cs.paddingLeft), top: parseFloat(cs.paddingTop) }
    })
    expect(body.left).toBeGreaterThanOrEqual(16)
    expect(body.top).toBeGreaterThanOrEqual(16)
    const done = await dialog.getByRole('button', { name: 'Done' }).boundingBox()
    // The sticky footer sits flush with the bottom of the dialog (no content peeking below it).
    const panel = (await dialog.boundingBox())!
    const footer = (await dialog.getByRole('button', { name: 'Done' }).evaluate((el) => el.parentElement!.getBoundingClientRect().bottom))
    expect(Math.abs(panel.y + panel.height - footer)).toBeLessThanOrEqual(2)
    expect(done!.height).toBeGreaterThanOrEqual(44)
    const close = await dialog.getByRole('button', { name: 'Close dialog' }).boundingBox()
    expect(close!.width).toBeGreaterThanOrEqual(44)
    expect(close!.height).toBeGreaterThanOrEqual(44)
  })
}

for (const [id, label] of PRESETS) {
  test(`axe: key routes are clean in ${label}`, async ({ page }) => {
    test.setTimeout(120_000)
    await page.setViewportSize({ width: 1280, height: 800 })
    await signIn(page)
    await openAppearance(page)
    await page.getByRole('radio', { name: label }).click()
    await expect(page.locator('html')).toHaveAttribute('data-theme', id)

    const findings: string[] = []
    // Dialog open (the Appearance dialog itself).
    await page.waitForTimeout(300)
    findings.push(...formatFindings('dialog', await axeFindings(page)))
    await page.getByRole('button', { name: 'Done' }).click()

    for (const [name, path, ready] of [
      ['dashboard', '/', 'main'],
      ['test cases', '/test-repository', 'main'],
    ] as const) {
      await page.goto(path)
      await page.waitForSelector(ready)
      await page.waitForTimeout(600)
      findings.push(...formatFindings(name, await axeFindings(page)))
    }
    await page.goto('/login')
    await page.waitForSelector('text=Sign in to your organization')
    findings.push(...formatFindings('login', await axeFindings(page)))
    expect(findings).toEqual([])
  })
}
