import { expect, test } from '@playwright/test'

import { bootstrapTenant, loginViaUi } from './fixtures'
import { LOOPBACK_WEB_URL } from './target'

// `localhost` and `127.0.0.1` are different sites to a browser, so a page on one
// calling an API on the other loses SameSite session cookies (the Platform Admin
// cookie is Strict). The web app now calls the API on the same loopback name as
// the page. This spec opens the app on 127.0.0.1 -- the OTHER name from the one
// the API address is configured with.

test.use({ baseURL: LOOPBACK_WEB_URL })

test('a tenant user can sign in on 127.0.0.1', async ({ page, request }) => {
  const tenant = await bootstrapTenant(request, 'LoopbackTenant')
  await loginViaUi(page, tenant.tenantId, tenant.adminEmail, tenant.adminPassword)
  await expect(page.getByRole('link', { name: 'Test Cases' }).first()).toBeVisible()
  expect(new URL(page.url()).hostname).toBe('127.0.0.1')
})

test('Platform Admin keeps its session cookie on 127.0.0.1', async ({ page }) => {
  await page.goto('/platform-admin')
  await page.getByLabel('Email').fill(process.env.E2E_PLATFORM_ADMIN_EMAIL ?? 'owner@qtesthub.local')
  await page
    .getByLabel('Password')
    .fill(process.env.E2E_PLATFORM_ADMIN_PASSWORD ?? 'Sup3rSecret1Pass')
  await page.getByRole('button', { name: 'Sign in' }).click()
  // Password accepted AND the cookie kept: the page moves on to the code step.
  await expect(page.getByLabel('Authentication code')).toBeVisible()
  await expect(page.getByText('did not keep the sign-in cookie')).toHaveCount(0)
})
