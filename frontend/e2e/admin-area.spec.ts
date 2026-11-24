import { expect, test } from '@playwright/test'

import { axeFindings, formatFindings } from './a11y'
import { loginViaUi } from './fixtures'
import { seedRoleTenant } from './roleTenant'

// Redesign step 7 (ADR-112): Admin layout with a left sub-nav.
test.setTimeout(300_000)

const SECTIONS = [
  ['Users & Roles', /\/admin\/users$/],
  ['Access Control', /\/admin\/roles$/],
  ['Environments', /\/admin\/environments$/],
  ['Settings', /\/settings$/],
  ['Workspace', /\/admin\/workspace$/],
  ['Audit Logs', /\/admin\/audit-logs$/],
] as const

test('admin: six sections, left nav navigates, aria-current moves, breadcrumb says Admin', async ({
  browser,
  request,
}) => {
  const t = await seedRoleTenant(request, 'AdminArea')
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  const page = await ctx.newPage()
  try {
    await loginViaUi(page, t.tenantId, t.adminEmail, t.adminPassword)
    await page.goto('/admin/users')
    const nav = page.getByRole('navigation', { name: 'Admin sections' })
    await expect(nav.getByRole('link')).toHaveCount(6)
    for (const [name, url] of SECTIONS) {
      await nav.getByRole('link', { name }).click()
      await expect(page).toHaveURL(url)
      await expect(nav.getByRole('link', { name })).toHaveAttribute('aria-current', 'page')
      await expect(nav.locator('[aria-current="page"]')).toHaveCount(1)
    }
    // Access Control keeps its in-page tabs and stays the active section on the second tab.
    await nav.getByRole('link', { name: 'Access Control' }).click()
    await page.getByRole('navigation', { name: 'Access control sections' }).getByRole('link', { name: 'Access rules' }).click()
    await expect(page).toHaveURL(/\/admin\/access-rules$/)
    await expect(nav.getByRole('link', { name: 'Access Control' })).toHaveAttribute('aria-current', 'page')
    await expect(page.getByRole('navigation', { name: 'Breadcrumb' }).getByRole('link', { name: 'Admin' })).toBeVisible()
    // Sidebar Admin item stays active on every admin route, Settings included.
    await page.goto('/settings')
    await expect(
      page.getByRole('complementary', { name: 'Sidebar' }).getByRole('link', { name: 'Admin' }),
    ).toHaveAttribute('aria-current', 'page')
    // The compact switcher is not shown at this width.
    await expect(page.getByRole('combobox', { name: 'Admin section' })).toBeHidden()
    expect(formatFindings('admin-area-1280', await axeFindings(page))).toEqual([])
  } finally {
    await ctx.close()
  }
})

test('manager sees only the sections they can open', async ({ browser, request }) => {
  const t = await seedRoleTenant(request, 'AdminAreaMgr')
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  const page = await ctx.newPage()
  try {
    await loginViaUi(page, t.tenantId, t.manager.email, t.manager.password)
    await page.goto('/admin/environments')
    await expect(page.getByRole('heading', { name: 'Environments' }).first()).toBeVisible()
    // One reachable section: no sub-nav, and the others are blocked by URL.
    await expect(page.getByRole('navigation', { name: 'Admin sections' })).toHaveCount(0)
    await expect(page.getByRole('link', { name: 'Users & Roles' })).toHaveCount(0)
    await page.goto('/admin/users')
    await expect(page.getByRole('navigation', { name: 'Admin sections' })).toHaveCount(0)
  } finally {
    await ctx.close()
  }
})

test('phone width shows the compact section switcher', async ({ browser, request }) => {
  const t = await seedRoleTenant(request, 'AdminAreaPhone')
  const ctx = await browser.newContext({ viewport: { width: 375, height: 800 } })
  const page = await ctx.newPage()
  try {
    await loginViaUi(page, t.tenantId, t.adminEmail, t.adminPassword)
    await page.goto('/admin/users')
    await expect(page.getByRole('navigation', { name: 'Admin sections' })).toBeHidden()
    const switcher = page.getByRole('combobox', { name: 'Admin section' })
    await expect(switcher).toBeVisible()
    await switcher.click()
    await page.getByRole('option', { name: 'Audit Logs' }).click()
    await expect(page).toHaveURL(/\/admin\/audit-logs$/)
    await expect(switcher).toContainText('Audit Logs')
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)
    expect(overflow).toBe(false)
  } finally {
    await ctx.close()
  }
})
