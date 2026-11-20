import { expect, test, type Page } from '@playwright/test'

import { bootstrapTenant, loginViaUi } from './fixtures'

// The header's right-hand controls take most of the width, so a long page title used to be
// truncated together with its parents ("Document… › API Specifi…"). The parent crumbs now
// give way first and the current page keeps its full title.

// The current page is the one crumb styled `font-medium` (true before and after the fix).
function currentPage(page: Page) {
  return page.locator('nav[aria-label="Breadcrumb"] span.truncate.font-medium')
}

async function isTruncated(page: Page) {
  return currentPage(page).evaluate((el) => el.scrollWidth > el.clientWidth + 1)
}

test('the current page keeps its full title in the breadcrumb on desktop', async ({ page, request }) => {
  const tenant = await bootstrapTenant(request, 'CrumbWidth')
  await loginViaUi(page, tenant.tenantId, tenant.adminEmail, tenant.adminPassword)

  for (const width of [1280, 1440]) {
    await page.setViewportSize({ width, height: 800 })
    for (const [path, title] of [
      ['/brd/api-specification', 'API Specification'],
      ['/brd/requirement-traceability', 'Requirement Traceability'],
    ] as const) {
      await page.goto(path)
      await expect(currentPage(page)).toHaveText(title)
      expect(await isTruncated(page), `${title} at ${width}px`).toBe(false)
    }
  }
})

test('the full text is on hover and the current page is marked for screen readers', async ({
  page,
  request,
}) => {
  const tenant = await bootstrapTenant(request, 'CrumbA11y')
  await loginViaUi(page, tenant.tenantId, tenant.adminEmail, tenant.adminPassword)
  await page.goto('/brd/requirement-traceability')
  const current = page.locator('nav[aria-label="Breadcrumb"] [aria-current="page"]')
  await expect(current).toHaveCount(1)
  await expect(current).toHaveText('Requirement Traceability')
  await expect(current).toHaveAttribute('title', 'Requirement Traceability')
})

test('on a phone only the current page shows, and it still fits', async ({ page, request }) => {
  const tenant = await bootstrapTenant(request, 'CrumbPhone')
  await page.setViewportSize({ width: 390, height: 844 })
  await loginViaUi(page, tenant.tenantId, tenant.adminEmail, tenant.adminPassword)
  await page.goto('/brd/requirement-traceability')
  await expect(currentPage(page)).toHaveText('Requirement Traceability')
  expect(await isTruncated(page)).toBe(false)
  await expect(page.locator('nav[aria-label="Breadcrumb"] a:visible')).toHaveCount(0)
})
