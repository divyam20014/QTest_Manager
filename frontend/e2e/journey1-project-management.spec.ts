import { expect, test } from '@playwright/test'

import { bootstrapTenant, loginViaUi } from './fixtures'

// BRD Journey 1: an Admin creates a project with the required insurance
// portfolio fields and sees it immediately in the tenant's project list.
test('Admin creates a project and it appears in the project list', async ({ page, request }) => {
  const tenant = await bootstrapTenant(request, 'J1Projects')
  await loginViaUi(page, tenant.tenantId, tenant.adminEmail, tenant.adminPassword)

  await page.click('a:has-text("Projects")')
  await page.click('button:has-text("New Project")')
  await page.waitForSelector('text=New Project')
  await page.fill('#name', 'Apex Motor Claims Modernization')
  await page.selectOption('#domain', 'Motor')
  await page.selectOption('#priority', 'High')
  await page.fill('#manager_name', 'Jane Manager')
  await page.fill('#start_date', '2026-01-01')
  await page.fill('#end_date', '2026-12-31')
  await page.fill('#budget', '450000')
  await page.fill('#region', 'North America')
  await page.click('button:has-text("Create Project")')

  await expect(page.getByRole('link', { name: 'Apex Motor Claims Modernization' })).toBeVisible({
    timeout: 10000,
  })

  await page.click('a:has-text("Apex Motor Claims Modernization")')
  await expect(page.getByText('Team Members')).toBeVisible({ timeout: 10000 })
})

test('Duplicate project name in the same tenant is rejected', async ({ page, request }) => {
  const tenant = await bootstrapTenant(request, 'J1Duplicate')
  await loginViaUi(page, tenant.tenantId, tenant.adminEmail, tenant.adminPassword)

  async function createProject() {
    await page.click('button:has-text("New Project")')
    await page.waitForSelector('text=New Project')
    await page.fill('#name', 'Health Claims Pilot')
    await page.selectOption('#domain', 'Health')
    await page.selectOption('#priority', 'Medium')
    await page.fill('#manager_name', 'Jane Manager')
    await page.fill('#start_date', '2026-01-01')
    await page.fill('#end_date', '2026-12-31')
    await page.fill('#budget', '100000')
    await page.fill('#region', 'EMEA')
    await page.click('button:has-text("Create Project")')
  }

  await page.click('a:has-text("Projects")')
  await createProject()
  await expect(page.getByRole('link', { name: 'Health Claims Pilot' })).toBeVisible({ timeout: 10000 })

  await createProject()
  await expect(page.getByText(/already exists/i)).toBeVisible({ timeout: 10000 })
})
