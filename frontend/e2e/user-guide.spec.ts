import { expect, test, type Page } from '@playwright/test'

import { axeFindings, formatFindings } from './a11y'
import { API_BASE_URL, loginViaUi } from './fixtures'
import { PLATFORM_DOCS_USER_AGENT, signInPlatformBrowser } from './platformDocs'
import { seedRoleTenant, type RoleTenant } from './roleTenant'

// ADR-114: the tenant User Guide shows only the role-based sections the API
// allows; the old Documentation link and /brd routes are gone; the full
// documentation is read in the platform console. Throwaway tenant only.

const sidebar = (page: Page) => page.getByRole('complementary', { name: 'Sidebar' })
const sectionLinks = (page: Page) => page.getByRole('navigation', { name: 'Guide sections' }).getByRole('link')

async function names(page: Page): Promise<string[]> {
  await expect(sectionLinks(page).first()).toBeVisible()
  return (await sectionLinks(page).allTextContents()).map((s) => s.trim())
}

let t: RoleTenant

test.beforeAll(async ({ request }) => {
  t = await seedRoleTenant(request, 'UserGuide')
})

test('User Guide: a Tester sees Getting started and For Testers only, opening on For Testers', async ({ page }) => {
  await loginViaUi(page, t.tenantId, t.tester.email, t.tester.password)
  await expect(sidebar(page).getByRole('link', { name: 'User Guide' })).toBeVisible()
  await expect(sidebar(page).getByRole('link', { name: 'Documentation' })).toHaveCount(0)

  await sidebar(page).getByRole('link', { name: 'User Guide' }).click()
  await expect(page).toHaveURL(/\/user-guide$/)
  await expect(page.getByRole('heading', { level: 1, name: 'User Guide' })).toBeVisible()
  expect(await names(page)).toEqual(['Getting started', 'For Testers'])
  await expect(page.getByRole('article', { name: 'For Testers' })).toBeVisible()
  await expect(page.getByText('Onboarding a team')).toHaveCount(0)

  // A deep link to a section the user may not read falls back to their own section.
  await page.goto('/user-guide#admin')
  await expect(page.getByRole('article', { name: 'For Testers' })).toBeVisible()
  await expect(page.getByRole('article', { name: 'For Admins' })).toHaveCount(0)

  // Switching sections updates the anchor.
  await page.goto('/user-guide')
  await sectionLinks(page).first().click()
  await expect(page).toHaveURL(/#getting-started$/)
  await expect(page.getByRole('article', { name: 'Getting started' })).toBeVisible()
})

test('User Guide: a Manager sees three sections, an Admin sees all four', async ({ page, browser }) => {
  await loginViaUi(page, t.tenantId, t.manager.email, t.manager.password)
  await page.goto('/user-guide')
  expect(await names(page)).toEqual(['Getting started', 'For Testers', 'For Managers'])
  await expect(page.getByRole('article', { name: 'For Managers' })).toBeVisible()

  const ctx = await browser.newContext()
  const admin = await ctx.newPage()
  try {
    await loginViaUi(admin, t.tenantId, t.adminEmail, t.adminPassword)
    await admin.goto('/user-guide')
    expect(await names(admin)).toEqual(['Getting started', 'For Testers', 'For Managers', 'For Admins'])
    await expect(admin.getByRole('article', { name: 'For Admins' })).toBeVisible()
    await expect(admin.getByRole('heading', { name: 'Onboarding a team' })).toBeVisible()
    await admin.goto('/user-guide#tester')
    await expect(admin.getByRole('article', { name: 'For Testers' })).toBeVisible()
    expect(formatFindings('user-guide-admin', await axeFindings(admin))).toEqual([])
  } finally {
    await ctx.close()
  }
})

test('User Guide: old /brd links redirect, the API serves no documents to tenants', async ({ page }) => {
  await loginViaUi(page, t.tenantId, t.tester.email, t.tester.password)
  for (const old of ['/brd', '/brd/user-guide', '/brd/administrator-guide']) {
    await page.goto(old)
    await expect(page).toHaveURL(/\/user-guide/)
  }
  const status = await page.evaluate(async (base) => {
    const out: number[] = []
    for (const path of ['/docs', '/docs/administrator-guide', '/platform/docs']) {
      out.push((await fetch(`${base}${path}`, { credentials: 'include' })).status)
    }
    return out
  }, API_BASE_URL)
  for (const s of status) expect([401, 403, 404]).toContain(s)
})

test('User Guide: phone layout uses the section selector and has no sideways scroll', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await loginViaUi(page, t.tenantId, t.manager.email, t.manager.password)
  await page.goto('/user-guide')
  await expect(page.getByRole('combobox', { name: 'Guide section' })).toBeVisible()
  await expect(page.getByRole('navigation', { name: 'Guide sections' })).toBeHidden()
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow).toBeLessThanOrEqual(0)
  await page.getByRole('button', { name: 'More' }).click()
  await expect(page.getByRole('dialog', { name: 'More' }).getByRole('link', { name: 'User Guide' })).toBeVisible()
})

test.describe('platform console', () => {
  test.use({ userAgent: PLATFORM_DOCS_USER_AGENT })

  test('Platform admin: the Documentation view lists every document, incl. the Administrator Guide', async ({
    page,
    context,
  }) => {
    await signInPlatformBrowser(context)
    await page.goto('/platform-admin')
    await page.getByRole('link', { name: 'Documentation' }).click()
    await expect(page).toHaveURL(/\/platform-admin\/docs\/user-guide$/)
    const nav = page.getByRole('navigation', { name: 'Documents' })
    await expect(nav.getByRole('link')).toHaveCount(24)
    await nav.getByRole('link', { name: 'Administrator Guide' }).click()
    await expect(page.locator('article h1').first()).toContainText('Administrator Guide')
  })
})
