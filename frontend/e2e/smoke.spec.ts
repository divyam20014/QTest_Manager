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

test('protected routes still redirect signed-out visitors to login', async ({ page }) => {
  await page.goto('/defects')
  await expect(page).toHaveURL(/\/login$/)
})
