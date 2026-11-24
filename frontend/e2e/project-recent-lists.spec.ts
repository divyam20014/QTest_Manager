import { expect, test, type Page } from '@playwright/test'

import { API_BASE_URL, bootstrapTenant, loginViaUi, seedDefectBody, seedCaseBody } from './fixtures'

// The "Recent test cases" and "Recent defects" panels on Project Detail were four-column
// tables that crammed long titles on a phone. On a phone they are now a list (wrapping
// title, badges and date underneath); desktop keeps the tables.

const LONG_DEFECT =
  'Premium recalculation fails when the policyholder changes the vehicle after the quote has been approved by underwriting'
const LONG_CASE =
  'Verify that a multi-vehicle household discount is applied once and only once across renewals in every region'

async function post(page: Page, path: string, data?: unknown) {
  const response = await page.request.post(`${API_BASE_URL}${path}`, { data })
  if (!response.ok()) throw new Error(`POST ${path} failed (${response.status()}): ${await response.text()}`)
  return (await response.json()).data
}

async function seed(page: Page) {
  const me = (await (await page.request.get(`${API_BASE_URL}/auth/me`)).json()).data as { user_id: string }
  const project = await post(page, '/projects', {
    name: 'Recent Lists Claims',
    domain: 'Motor',
    priority: 'High',
    manager_name: 'Jane Manager',
    start_date: '2026-01-01',
    end_date: '2026-12-31',
    budget: '1000.00',
    region: 'North America',
  })
  if (!project.assigned_user_ids.includes(me.user_id)) {
    await post(page, `/projects/${project.id}/members`, { user_id: me.user_id })
  }
  await post(page, `/projects/${project.id}/test-cases`, await seedCaseBody(page.request, project.id, {
    title: LONG_CASE,
    priority: 'High',
    steps: [{ action: 'Open', expected: 'Opens' }],
  }))
  await post(page, '/defects', seedDefectBody(project.id, { title: LONG_DEFECT, severity: 'Critical', description: 'Recent lists test' }))
  return project.id as string
}

test('phone: the recent lists wrap long titles, fit the screen and keep 44px targets', async ({
  page,
  request,
}) => {
  const tenant = await bootstrapTenant(request, 'RecentPhone')
  await page.setViewportSize({ width: 390, height: 844 })
  await loginViaUi(page, tenant.tenantId, tenant.adminEmail, tenant.adminPassword)
  const projectId = await seed(page)
  await page.goto(`/projects/${projectId}/activity`)

  const defects = page.getByRole('list', { name: 'Five most recently reported defects' })
  const cases = page.getByRole('list', { name: 'Five most recently created test cases' })
  await expect(defects).toBeVisible()
  await expect(cases).toBeVisible()
  // No cramped four-column table for these two panels on a phone.
  await expect(page.getByRole('table', { name: /most recently (reported|created)/ })).toHaveCount(0)

  // The long title wraps in full and is a 44px-or-taller link to the defect.
  const link = defects.getByRole('link', { name: LONG_DEFECT })
  await expect(link).toBeVisible()
  expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(44)
  await expect(defects.getByText('Critical')).toBeVisible()
  await expect(cases.getByRole('link', { name: LONG_CASE })).toBeVisible()

  // Nothing makes the page scroll sideways.
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
  expect(overflow).toBeLessThanOrEqual(0)

  await link.click()
  await expect(page).toHaveURL(/\/defects\/[0-9a-f-]+$/)
})

test('desktop keeps the tables', async ({ page, request }) => {
  const tenant = await bootstrapTenant(request, 'RecentDesktop')
  await page.setViewportSize({ width: 1280, height: 800 })
  await loginViaUi(page, tenant.tenantId, tenant.adminEmail, tenant.adminPassword)
  const projectId = await seed(page)
  await page.goto(`/projects/${projectId}/activity`)

  await expect(page.getByRole('table', { name: 'Five most recently reported defects' })).toBeVisible()
  await expect(page.getByRole('table', { name: 'Five most recently created test cases' })).toBeVisible()
  await expect(page.getByRole('list', { name: /most recently (reported|created)/ })).toHaveCount(0)
})
