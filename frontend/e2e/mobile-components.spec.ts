import { expect, test, type Page } from '@playwright/test'

import { API_BASE_URL, bootstrapTenant, loginViaUi } from './fixtures'

// Mobile redesign Phase 2: bottom-sheet dialogs, 16px/44px form controls,
// card lists in place of tables, the Filters sheet, and the Phase 1 fixes
// (pinned Sign out, one shared theme state).
test.use({ viewport: { width: 390, height: 844 } })

async function seed(page: Page) {
  const api = page.request
  const project = (
    await (
      await api.post(`${API_BASE_URL}/projects`, {
        data: {
          name: 'Apex Motor Claims',
          domain: 'Motor',
          priority: 'High',
          manager_name: 'Jane Manager',
          start_date: '2026-01-01',
          end_date: '2026-12-31',
          budget: '450000.00',
          region: 'North America',
        },
      })
    ).json()
  ).data
  for (const title of ['Verify claim settlement calculation', 'Reject a duplicate claim submission']) {
    await api.post(`${API_BASE_URL}/projects/${project.id}/test-cases`, {
      data: { title, priority: 'High', steps: [{ action: 'Do X', expected: 'Y' }] },
    })
  }
  await api.post(`${API_BASE_URL}/defects`, {
    data: {
      project_id: project.id,
      title: 'Settlement total rounds the wrong way on multi-vehicle claims',
      severity: 'High',
      priority: 'High',
      description: 'Seeded for the mobile spec',
    },
  })
}

async function noHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
  expect(overflow).toBeLessThanOrEqual(0)
}

test('mobile components: card lists, filters sheet, form sheet, pinned sign-out, shared theme', async ({
  page,
  request,
}) => {
  const tenant = await bootstrapTenant(request, 'MobileParts')
  await loginViaUi(page, tenant.tenantId, tenant.adminEmail, tenant.adminPassword)
  await seed(page)

  // --- Defects: a card list instead of a table --------------------------------
  await page.goto('/defects')
  const cards = page.getByRole('list', { name: 'Defects' })
  await expect(cards).toBeVisible()
  await expect(cards.getByRole('listitem')).toHaveCount(1)
  await expect(page.locator('table')).toHaveCount(0)
  await noHorizontalOverflow(page)
  // The whole card is one big link target (title link stretched over it).
  const card = cards.getByRole('listitem').first()
  const link = card.getByRole('link', { name: /Settlement total rounds/ })
  const cardBox = (await card.boundingBox())!
  expect(cardBox.height).toBeGreaterThanOrEqual(44)
  await expect(link).toBeVisible()

  // --- Filters sheet -----------------------------------------------------------
  const filtersButton = page.getByRole('button', { name: /^Filters/ })
  await expect(filtersButton).toBeVisible()
  expect((await filtersButton.boundingBox())!.height).toBeGreaterThanOrEqual(44)
  await filtersButton.click()
  const sheet = page.getByRole('dialog', { name: 'Filters' })
  await expect(sheet).toBeVisible()
  // Bottom sheet: full width, flush with the bottom of the screen.
  // (poll: the sheet slides up for 0.2s, so wait for it to settle)
  await expect.poll(async () => {
    const box = (await sheet.boundingBox())!
    return [Math.round(box.width), Math.round(box.y + box.height)]
  }).toEqual([390, 844])
  const status = sheet.getByLabel('Filter by status')
  const statusBox = (await status.boundingBox())!
  expect(statusBox.height).toBeGreaterThanOrEqual(44)
  expect(statusBox.width).toBeGreaterThan(300)
  expect(await status.evaluate((el) => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(16)
  await status.selectOption('Open')
  await expect(sheet.getByRole('button', { name: 'Clear filters' })).toBeEnabled()
  await sheet.getByRole('button', { name: 'Done' }).click()
  await expect(sheet).toBeHidden()
  // Active filter count on the button, and the empty result for status=Open.
  await expect(filtersButton.getByLabel('1 active')).toBeVisible()
  await expect(page.getByText('No defects match your filters')).toBeVisible()
  await noHorizontalOverflow(page)
  await filtersButton.click()
  await sheet.getByRole('button', { name: 'Clear filters' }).click()
  await page.keyboard.press('Escape')
  await expect(sheet).toBeHidden()
  await expect(cards.getByRole('listitem')).toHaveCount(1)

  // --- New Defect: bottom-sheet dialog with a pinned action bar ---------------
  await page.getByRole('button', { name: 'New Defect' }).click()
  const dialog = page.getByRole('dialog', { name: 'New Defect' })
  await expect(dialog).toBeVisible()
  await expect.poll(async () => {
    const box = (await dialog.boundingBox())!
    return [Math.round(box.width), Math.round(box.y + box.height)]
  }).toEqual([390, 844])
  const title = dialog.getByLabel('Title')
  expect((await title.boundingBox())!.height).toBeGreaterThanOrEqual(44)
  expect(await title.evaluate((el) => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(16)
  const create = dialog.getByRole('button', { name: 'Create Defect' })
  await expect(create).toBeInViewport()
  expect((await create.boundingBox())!.height).toBeGreaterThanOrEqual(44)
  expect((await dialog.getByRole('button', { name: 'Close dialog' }).boundingBox())!.width).toBeGreaterThanOrEqual(44)
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()

  // --- Test Repository: cards + selection + bulk bar --------------------------
  await page.goto('/test-repository')
  const repoCards = page.getByRole('list', { name: 'Test cases' })
  await expect(repoCards.getByRole('listitem')).toHaveCount(2)
  await expect(page.locator('table')).toHaveCount(0)
  await noHorizontalOverflow(page)
  // Search stays visible beside the Filters button.
  await expect(page.locator('#repo-search')).toBeVisible()
  await page
    .getByRole('checkbox', { name: 'Select Verify claim settlement calculation' })
    .check()
  await expect(page.getByText('1 selected', { exact: true })).toBeVisible()
  await page.getByRole('checkbox', { name: 'Select all' }).check()
  await expect(page.getByText('2 selected', { exact: true })).toBeVisible()
  // The card's inline "Submit" action is a real, thumb-sized button.
  const submit = repoCards.getByRole('listitem').first().getByRole('button', { name: 'Submit' })
  expect((await submit.boundingBox())!.height).toBeGreaterThanOrEqual(44)
  await page.getByRole('button', { name: 'Clear selection' }).click()

  await page.getByRole('button', { name: /^Filters/ }).click()
  const repoSheet = page.getByRole('dialog', { name: 'Filters' })
  await repoSheet.getByLabel('Priority').selectOption('Critical')
  await repoSheet.getByRole('button', { name: 'Done' }).click()
  await expect(page.getByText('No test cases match these filters.')).toBeVisible()
  await noHorizontalOverflow(page)

  // --- More sheet: Sign out is pinned; theme state is shared ------------------
  const bar = page.getByRole('navigation', { name: 'Primary' })
  await bar.getByRole('button', { name: 'More' }).click()
  const more = page.getByRole('dialog', { name: 'More' })
  await expect(more.getByRole('button', { name: 'Sign out' })).toBeInViewport()
  await expect(more.getByRole('button', { name: 'Sign out' })).toBeVisible()
  const themeInSheet = more.getByRole('button', { name: /mode$/ })
  const before = await page.evaluate(() => document.documentElement.dataset.theme)
  await themeInSheet.click()
  const after = await page.evaluate(() => document.documentElement.dataset.theme)
  expect(after).not.toBe(before)
  // Every theme toggle in the DOM (sheet + the desktop one hidden on phones)
  // agrees on the same state.
  const labels = await page
    .locator('button[aria-label^="Switch to"]')
    .evaluateAll((els) => els.map((el) => el.getAttribute('aria-label')))
  expect(labels.length).toBeGreaterThanOrEqual(2)
  expect(new Set(labels).size).toBe(1)
})
