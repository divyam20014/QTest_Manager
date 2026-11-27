import { expect, test, type APIRequestContext } from '@playwright/test'

import { API_BASE_URL, bootstrapTenant, loginViaUi, platformAuthHeaders, getPlatformSessionToken } from './fixtures'
import { PLATFORM_DOCS_USER_AGENT, signInPlatformBrowser } from './platformDocs'
import { WEB_URL } from './target'

// ADR-089 / ADR-114: documents are served by the API and never bundled into the
// web app; the full set is readable only with a platform session, tenant users
// get the role-filtered User Guide. Each test uses its own throwaway tenant.

// Distinctive lines from documents that must never appear in a front-end asset.
const SENTINELS = ['Database Schema — QTestHub', 'QTestHub — Production Deployment Guide', 'Architecture Decision Records (ADR)']

async function createTester(request: APIRequestContext, tenant: Awaited<ReturnType<typeof bootstrapTenant>>) {
  const login = await request.post(`${API_BASE_URL}/auth/login`, {
    data: { tenant_id: tenant.tenantId, email: tenant.adminEmail, password: tenant.adminPassword },
  })
  await request.post(`${API_BASE_URL}/auth/mfa/verify`, { data: { code: (await login.json()).data.debug_code } })
  const email = `tester-${tenant.tenantId.slice(0, 8)}@example.com`
  const password = 'TesterPassw0rd1!'
  const res = await request.post(`${API_BASE_URL}/users`, {
    data: { email, name: 'Tess Tester', role: 'tester', password },
  })
  expect(res.ok()).toBeTruthy()
  return { email, password }
}

test('Docs API: signed-out requests get no documents and no guide', async ({ request }) => {
  for (const path of ['/docs', '/docs/database-schema', '/docs/user-guide']) {
    expect([401, 404], path).toContain((await request.get(`${API_BASE_URL}${path}`)).status())
  }
  expect((await request.get(`${API_BASE_URL}/user-guide`)).status()).toBe(401)
  for (const path of ['/platform/docs', '/platform/docs/database-schema']) {
    expect([401, 403], path).toContain((await request.get(`${API_BASE_URL}${path}`)).status())
  }
})

test('Docs API: a platform session reads every document; a tenant Admin cannot', async ({ request }) => {
  const headers = platformAuthHeaders(await getPlatformSessionToken())
  const listing = await request.get(`${API_BASE_URL}/platform/docs`, { headers })
  expect(listing.status()).toBe(200)
  expect((await listing.json()).data.documents).toHaveLength(24)
  const one = await request.get(`${API_BASE_URL}/platform/docs/database-schema`, { headers })
  expect(one.status()).toBe(200)
  expect((await one.json()).data.content).toContain('Database Schema')

  const tenant = await bootstrapTenant(request, 'DocsAdminDenied')
  const login = await request.post(`${API_BASE_URL}/auth/login`, {
    data: { tenant_id: tenant.tenantId, email: tenant.adminEmail, password: tenant.adminPassword },
  })
  await request.post(`${API_BASE_URL}/auth/mfa/verify`, { data: { code: (await login.json()).data.debug_code } })
  for (const path of ['/docs', '/docs/administrator-guide', '/platform/docs', '/platform/docs/administrator-guide']) {
    const res = await request.get(`${API_BASE_URL}${path}`)
    expect([401, 403, 404], path).toContain(res.status())
    expect(await res.text()).not.toContain('Administrator Guide')
  }
})

test('Docs: a tenant Admin has no Documentation entry, and /brd links land on the User Guide', async ({
  page,
  request,
}) => {
  const tenant = await bootstrapTenant(request, 'DocsAdmin')
  await loginViaUi(page, tenant.tenantId, tenant.adminEmail, tenant.adminPassword)
  await expect(page.getByRole('link', { name: 'Documentation' })).toHaveCount(0)
  for (const old of ['/brd', '/brd/administrator-guide']) {
    await page.goto(old)
    await expect(page).toHaveURL(/\/user-guide$/)
    await expect(page.getByRole('heading', { level: 1, name: 'User Guide' })).toBeVisible()
  }
  await expect(page.getByText('Administrator Guide')).toHaveCount(0)
})

test.describe('platform console', () => {
  test.use({ userAgent: PLATFORM_DOCS_USER_AGENT })

  test('Docs: the console has a Documentation view with every document and working diagrams', async ({
    page,
    context,
  }) => {
    await signInPlatformBrowser(context)
    await page.goto('/platform-admin')
    await page.getByRole('link', { name: 'Documentation' }).click()
    await expect(page).toHaveURL(/\/platform-admin\/docs\/user-guide$/)
    const nav = page.getByRole('navigation', { name: 'Documents' })
    for (const name of ['Administrator Guide', 'Database Schema', 'API Specification', 'Known Gaps']) {
      await expect(nav.getByRole('link', { name })).toBeVisible()
    }
    // An internal document link stays inside the platform route.
    await nav.getByRole('link', { name: 'System Architecture' }).click()
    await expect(page).toHaveURL(/\/platform-admin\/docs\/system-architecture$/)
    await expect(page.locator('figure.brd-diagram[data-state="ready"]').first()).toBeVisible({ timeout: 60_000 })
    await expect(page.locator('figure.brd-diagram[data-state="error"]')).toHaveCount(0)
    await page.getByRole('link', { name: 'Back to console' }).click()
    await expect(page).toHaveURL(/\/platform-admin$/)
  })

  test('Docs: without a platform session the documentation asks you to sign in', async ({ page }) => {
    await page.goto('/platform-admin/docs/database-schema')
    await expect(page.getByText('Sign in to read the documentation')).toBeVisible()
    await expect(page.locator('article')).toHaveCount(0)
  })

  test('Docs: the JavaScript the browser downloads contains no document text', async ({ page, context, request }) => {
    await signInPlatformBrowser(context)
    const scripts: string[] = []
    page.on('response', (res) => {
      const type = res.headers()['content-type'] ?? ''
      if (/javascript|typescript|text\/plain/.test(type) || /\.(m?js|tsx?)(\?|$)/.test(res.url())) {
        if (res.url().startsWith(WEB_URL)) scripts.push(res.url())
      }
    })
    await page.goto('/platform-admin/docs/administrator-guide')
    await expect(page.locator('article h1').first()).toBeVisible()
    expect(scripts.length).toBeGreaterThan(5)
    for (const url of scripts) {
      const body = await (await request.get(url)).text()
      for (const sentinel of SENTINELS) expect(body.includes(sentinel), `${sentinel} found in ${url}`).toBe(false)
    }
  })
})

// A tester never reaches platform documents either.
test('Docs: a Tester has no documentation route or API', async ({ page, request }) => {
  const tenant = await bootstrapTenant(request, 'DocsTester')
  const tester = await createTester(request, tenant)
  await loginViaUi(page, tenant.tenantId, tester.email, tester.password)
  await page.goto('/platform-admin/docs/database-schema')
  await expect(page.getByText('Sign in to read the documentation')).toBeVisible()
  await expect(page.getByText('Database Schema — QTestHub')).toHaveCount(0)
})
