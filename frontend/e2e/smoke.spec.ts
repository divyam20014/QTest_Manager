import { expect, test } from '@playwright/test'

test('app shell renders', async ({ page }) => {
  await page.goto('/login')
  await expect(page.getByRole('heading', { name: 'QTestHub' })).toBeVisible()
})

test('signed-out visitors get the public home page at /', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1, name: /Quality Isn.t Just Tested/ })).toBeVisible()
  await expect(page).toHaveTitle('QTestHub | Enterprise Quality Engineering & Test Management Platform')
  await page.getByRole('banner').getByRole('link', { name: 'Sign In' }).click()
  await expect(page).toHaveURL(/\/login$/)
})

test('marketing pages are public and link to the demo request form', async ({ page }) => {
  await page.goto('/pricing')
  await expect(page).toHaveTitle('Pricing | QTestHub')
  await page.getByRole('banner').getByRole('link', { name: 'Request a Demo' }).click()
  await expect(page).toHaveURL(/\/request-demo$/)
  await expect(page.getByRole('form', { name: 'Request a demo' })).toBeVisible()
})

test('the guided walkthrough opens, steps through and closes', async ({ page }) => {
  await page.goto('/')
  const trigger = page.getByRole('button', { name: 'Or take the 2-minute product tour' })
  await trigger.click()
  const dialog = page.getByRole('dialog', { name: 'Explore QTestHub in 2 Minutes' })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByText('Read-only preview with sample data')).toBeVisible()
  await expect(dialog.getByText('Step 1 of 8')).toBeVisible()
  await dialog.getByRole('button', { name: 'Next' }).click()
  await expect(dialog.getByText('Step 2 of 8')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await expect(trigger).toBeFocused()
})

test('the Quality Intelligence Center shows how each part connects', async ({ page }) => {
  await page.goto('/quality-intelligence#center')
  await page.getByRole('button', { name: /^Risk-Based Testing/ }).click()
  await expect(page.getByRole('region', { name: 'Risk-Based Testing details' })).toContainText('not available')
  await page.getByRole('button', { name: /^Defects/ }).click()
  await expect(page.getByRole('region', { name: 'Defects details' })).toContainText('Failures')
})

test('protected routes still redirect signed-out visitors to login', async ({ page }) => {
  await page.goto('/defects')
  await expect(page).toHaveURL(/\/login$/)
})
