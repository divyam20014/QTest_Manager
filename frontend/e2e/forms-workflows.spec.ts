import { expect, test, type Page } from '@playwright/test'

import { axeFindings } from './a11y'
import { API_BASE_URL, loginViaUi } from './fixtures'
import { seedRoleTenant } from './roleTenant'

// ADR-106: quick-create test case, requirement-link combobox, Create and start.
// Real backend, own throwaway tenant.

async function post(page: Page, path: string, data?: unknown) {
  const response = await page.request.post(`${API_BASE_URL}${path}`, { data })
  if (!response.ok()) throw new Error(`POST ${path} failed (${response.status()}): ${await response.text()}`)
  return (await response.json()).data
}

async function seed(page: Page, adminId: string) {
  const project = await post(page, '/projects', {
    name: 'Forms Project',
    domain: 'Motor',
    priority: 'High',
    manager_name: 'Jane Manager',
    start_date: '2026-01-01',
    end_date: '2026-12-31',
    budget: '1000.00',
    region: 'North America',
  })
  if (!project.assigned_user_ids.includes(adminId)) {
    await post(page, `/projects/${project.id}/members`, { user_id: adminId })
  }
  const mod = await post(page, `/projects/${project.id}/modules`, { name: 'Claims module' })
  for (const title of ['Claims intake validation', 'Claims payout limits', 'Login lockout policy']) {
    await post(page, `/projects/${project.id}/requirements`, { title, description: '' })
  }
  return { projectId: project.id as string, moduleId: mod.id as string }
}

async function noOverflow(page: Page) {
  const o = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(o).toBeLessThanOrEqual(0)
}

test('quick-create, link requirements, create and start (1280)', async ({ page, request }) => {
  test.setTimeout(240_000)
  await page.setViewportSize({ width: 1280, height: 900 })
  const t = await seedRoleTenant(request, 'FormsWf', { withData: true })
  await loginViaUi(page, t.tenantId, t.adminEmail, t.adminPassword)
  const me = await (await page.request.get(`${API_BASE_URL}/auth/me`)).json()
  const { projectId, moduleId } = await seed(page, (me.data?.user_id ?? me.data?.id) as string)

  // Dashboard action opens the quick dialog directly.
  await page.goto(`/projects/${projectId}`)
  await page.getByRole('link', { name: 'New test case' }).click()
  const dialog = page.getByRole('dialog', { name: 'Quick add test case' })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByLabel('Title')).toBeFocused()
  expect(await axeFindings(page)).toEqual([])

  // Validation is announced and linked to the field.
  await dialog.getByRole('button', { name: 'Create', exact: true }).click()
  await expect(dialog.getByRole('alert').first()).toContainText('At least 5 characters')
  await expect(dialog.getByLabel('Title')).toHaveAttribute('aria-invalid', 'true')

  // Two steps by keyboard, Module, then Ctrl+Enter.
  await dialog.getByLabel('Title').fill('Quick one: claim intake')
  await dialog.getByLabel('Module').selectOption(moduleId)
  await dialog.getByLabel('Step 1 action').fill('Open the claim form')
  await dialog.getByLabel('Step 1 action').press('Enter')
  await dialog.getByLabel('Step 1 expected outcome').fill('Form opens')
  await dialog.getByLabel('Step 1 expected outcome').press('Enter')
  await expect(dialog.getByLabel('Step 2 action')).toBeFocused()
  await dialog.getByLabel('Step 2 action').fill('Submit it')
  await dialog.getByLabel('Step 2 expected outcome').fill('Claim saved')
  await page.screenshot({ path: 'test-results/quick-create-1280.png' })
  await page.keyboard.press('Control+Enter')
  await expect(dialog).toBeHidden()
  await expect(page).toHaveURL(/\/test-cases$/)
  await expect(page.getByText('Quick one: claim intake').first()).toBeVisible()

  // Create and add another keeps priority + module, clears title, refocuses Title.
  await page.getByRole('button', { name: 'Quick add' }).click()
  await dialog.getByLabel('Priority').selectOption({ index: 1 })
  const keptPriority = await dialog.getByLabel('Priority').inputValue()
  expect(keptPriority).not.toBe('')
  await dialog.getByLabel('Module').selectOption(moduleId)
  await dialog.getByLabel('Title').fill('Second quick case')
  await dialog.getByLabel('Step 1 action').fill('Do a')
  await dialog.getByLabel('Step 1 expected outcome').fill('See b')
  await dialog.getByRole('button', { name: 'Create and add another' }).click()
  await expect(dialog.getByLabel('Title')).toHaveValue('')
  await expect(dialog.getByLabel('Title')).toBeFocused()
  await expect(dialog.getByLabel('Priority')).toHaveValue(keptPriority)
  await expect(dialog.getByLabel('Module')).toHaveValue(moduleId)
  await expect(dialog.getByLabel('Step 1 action')).toHaveValue('')

  // More options carries the entered values into the full form.
  await dialog.getByLabel('Title').fill('Carried to full form')
  await dialog.getByLabel('Step 1 action').fill('Carry me')
  await dialog.getByRole('button', { name: 'More options' }).click()
  const drawer = page.getByRole('dialog', { name: 'New Test Case' })
  await expect(drawer.locator('#title')).toHaveValue('Carried to full form')
  await expect(drawer.getByLabel('Priority')).toHaveValue(keptPriority)
  await expect(drawer.getByLabel('Step 1 action')).toHaveValue('Carry me')
  await drawer.getByRole('button', { name: 'Close panel' }).click()
  await expect(drawer).toBeHidden()

  // Link requirements from case detail through the combobox.
  await page.getByRole('link', { name: 'Quick one: claim intake' }).first().click()
  const combo = page.getByRole('combobox', { name: 'Requirements' })
  await combo.fill('claims')
  await expect(page.getByRole('listbox', { name: 'Requirements' }).getByRole('option')).toHaveCount(2)
  expect(await axeFindings(page)).toEqual([])
  await page.getByRole('option', { name: 'Claims intake validation' }).click()
  await expect(page.getByRole('button', { name: 'Remove requirement Claims intake validation' })).toBeVisible()
  await combo.fill('payout')
  await combo.press('Enter')
  await expect(page.getByRole('button', { name: 'Remove requirement Claims payout limits' })).toBeVisible()
  await combo.fill('lockout')
  await page.getByRole('option', { name: 'Login lockout policy' }).click()
  await page.getByRole('button', { name: 'Remove requirement Login lockout policy' }).click()
  await expect(page.getByRole('button', { name: 'Remove requirement Login lockout policy' })).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'Claims payout limits' })).toHaveAttribute('href', /\/requirements\//)
  await page.reload()
  await expect(page.getByRole('link', { name: 'Claims intake validation' })).toBeVisible()

  // ...and see them in the traceability matrix.
  await page.goto(`/projects/${projectId}/traceability-matrix`)
  await expect(page.getByText('Claims intake validation').first()).toBeVisible()
  await expect(page.getByText('Claims payout limits').first()).toBeVisible()
  await expect(
    page.getByRole('row', { name: /Claims intake validation/ }).getByRole('link', { name: '1', exact: true }),
  ).toBeVisible()

  // Create and start lands on the Execution Console.
  const list = await (await page.request.get(`${API_BASE_URL}/projects/${projectId}/test-cases?page_size=100`)).json()
  const tc = list.data.items.find((c: { title: string }) => c.title === 'Quick one: claim intake')
  await post(page, `/test-cases/${tc.id}/submit-review`, {})
  await post(page, `/test-cases/${tc.id}/approve`)
  await page.goto(`/projects/${projectId}/test-runs`)
  await page.getByRole('button', { name: 'New Test Run' }).click()
  await page.getByLabel('Name').fill('Smoke via quick start')
  await page.getByLabel('Quick one: claim intake').check()
  await page.getByRole('button', { name: 'Create and start' }).click()
  await expect(page).toHaveURL(/\/test-run-cases\//)
  await expect(page.getByRole('complementary', { name: 'Test cases in this run' })).toBeVisible()
})

test.describe('phone', () => {
  test.use({ viewport: { width: 390, height: 844 } })

  test('quick dialog and requirement combobox at 390: axe, targets, no overflow', async ({ page, request }) => {
    test.setTimeout(180_000)
    const t = await seedRoleTenant(request, 'FormsWfM', { withData: true })
    await loginViaUi(page, t.tenantId, t.adminEmail, t.adminPassword)
    const me = await (await page.request.get(`${API_BASE_URL}/auth/me`)).json()
    const { projectId } = await seed(page, (me.data?.user_id ?? me.data?.id) as string)
    const tc = await post(page, `/projects/${projectId}/test-cases`, {
      title: 'Phone case',
      priority: 'High',
      steps: [{ action: 'a', expected: 'b' }],
    })

    await page.goto(`/projects/${projectId}/test-cases?quick=1`)
    const dialog = page.getByRole('dialog', { name: 'Quick add test case' })
    await expect(dialog).toBeVisible()
    await dialog.getByLabel('Title').fill('Phone quick case')
    const create = dialog.getByRole('button', { name: 'Create', exact: true })
    expect((await create.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(43.5)
    expect(await axeFindings(page)).toEqual([])
    await noOverflow(page)

    await page.goto(`/test-cases/${tc.id}`)
    const combo = page.getByRole('combobox', { name: 'Requirements' })
    await combo.fill('claims')
    await expect(page.getByRole('listbox', { name: 'Requirements' }).getByRole('option')).toHaveCount(2)
    expect(await axeFindings(page)).toEqual([])
    await page.screenshot({ path: 'test-results/req-combobox-390.png' })
    await page.getByRole('option', { name: 'Claims payout limits' }).click()
    const remove = page.getByRole('button', { name: 'Remove requirement Claims payout limits' })
    expect((await remove.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(43.5)
    await noOverflow(page)
  })
})
