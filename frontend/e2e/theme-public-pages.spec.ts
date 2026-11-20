import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'

// Public pages (sign-in, sign-up, Platform Admin) used to ignore the saved
// light/dark choice until the signed-in shell mounted. public/theme-init.js now
// applies it before the first paint. The OS preference is forced to the OPPOSITE
// of the saved choice so only the saved choice can make these pass.

const PAGES = ['/login', '/signup', '/platform-admin']

async function backgroundLuminance(page: Page): Promise<number> {
  return page.evaluate(() => {
    const [r, g, b] = getComputedStyle(document.body)
      .backgroundColor.match(/[\d.]+/g)!
      .slice(0, 3)
      .map(Number)
    return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
  })
}

for (const [saved, os] of [
  ['dark', 'light'],
  ['light', 'dark'],
] as const) {
  test.describe(`saved ${saved}, OS ${os}`, () => {
    test.use({ colorScheme: os })

    for (const path of PAGES) {
      test(`${path} honours the saved choice`, async ({ page }) => {
        await page.addInitScript((value) => localStorage.setItem('qtesthub:theme', value), saved)
        await page.goto(path)
        await expect(page.locator('html')).toHaveAttribute('data-theme', saved)
        const luminance = await backgroundLuminance(page)
        if (saved === 'dark') expect(luminance).toBeLessThan(0.3)
        else expect(luminance).toBeGreaterThan(0.7)
      })
    }
  })
}

test.describe('nothing saved', () => {
  test.use({ colorScheme: 'dark' })
  test('follows the OS preference', async ({ page }) => {
    await page.goto('/login')
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  })
})

test.describe('dark public pages stay accessible', () => {
  test.use({ colorScheme: 'light' })
  for (const path of PAGES) {
    test(`${path} has no WCAG A/AA violations in dark mode`, async ({ page }) => {
      await page.addInitScript(() => localStorage.setItem('qtesthub:theme', 'dark'))
      await page.goto(path)
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
      const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()
      expect(results.violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([])
    })
  }
})
