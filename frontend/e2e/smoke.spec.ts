import { expect, test } from '@playwright/test'

test('app shell renders', async ({ page }) => {
  await page.goto('/login')
  await expect(page.getByRole('heading', { name: 'QTestHub' })).toBeVisible()
})

test('signed-out visitors get the public landing page at /', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1, name: /Quality Engineering/ })).toBeVisible()
  await expect(page).toHaveTitle('QTestHub | Enterprise QA Test Management Platform')
  await page.getByRole('banner').getByRole('link', { name: 'Sign In' }).click()
  await expect(page).toHaveURL(/\/login$/)
})

test('protected routes still redirect signed-out visitors to login', async ({ page }) => {
  await page.goto('/defects')
  await expect(page).toHaveURL(/\/login$/)
})
