import { expect, test, type APIRequestContext } from '@playwright/test'

import { API_BASE_URL, bootstrapTenant, loginViaUi } from './fixtures'

// ADR-089 (issue 32): the in-app documents are served by the API behind a
// session, sensitive ones to Admin only, and the web bundle carries no document
// text. Each test uses its own throwaway tenant.

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

test('Docs API: a signed-out request is refused with 401', async ({ request }) => {
  for (const path of ['/docs', '/docs/database-schema', '/docs/user-guide']) {
    const res = await request.get(`${API_BASE_URL}${path}`)
    expect(res.status(), path).toBe(401)
  }
})

test('Docs: Admin opens the Administrator Guide and sees the sensitive documents listed', async ({ page, request }) => {
  const tenant = await bootstrapTenant(request, 'DocsAdmin')
  await loginViaUi(page, tenant.tenantId, tenant.adminEmail, tenant.adminPassword)
  await page.goto('/brd/administrator-guide')
  await expect(page.locator('article h1').first()).toContainText('Administrator Guide')
  const nav = page.getByRole('navigation', { name: 'Documents' })
  for (const name of ['Database Schema', 'API Specification', 'Architecture Decisions', 'Known Gaps']) {
    await expect(nav.getByRole('link', { name })).toBeVisible()
  }
})

test('Docs: a Tester does not see sensitive documents, and a deep link shows "No access"', async ({
  page,
  request,
}) => {
  const tenant = await bootstrapTenant(request, 'DocsTester')
  const tester = await createTester(request, tenant)
  await loginViaUi(page, tenant.tenantId, tester.email, tester.password)
  await page.goto('/brd')
  await expect(page).toHaveURL(/\/brd\/user-guide$/)
  await expect(page.locator('article h1').first()).toContainText('User Guide')
  const nav = page.getByRole('navigation', { name: 'Documents' })
  await expect(nav.getByRole('link', { name: 'Product Vision' })).toBeVisible()
  for (const name of ['Administrator Guide', 'Database Schema', 'API Specification', 'Known Gaps']) {
    await expect(nav.getByRole('link', { name })).toHaveCount(0)
  }

  await page.goto('/brd/database-schema')
  await expect(page.getByRole('heading', { name: /don.t have access/i })).toBeVisible()
  await expect(page.locator('article')).toHaveCount(0)
  await expect(page.getByText('Database Schema — QTestHub')).toHaveCount(0)
})

test('Docs: a general document renders its Mermaid diagrams', async ({ page, request }) => {
  const tenant = await bootstrapTenant(request, 'DocsMermaid')
  const tester = await createTester(request, tenant)
  await loginViaUi(page, tenant.tenantId, tester.email, tester.password)
  await page.goto('/brd/system-architecture')
  await expect(page.locator('figure.brd-diagram').first()).toBeVisible()
  await expect(page.locator('figure.brd-diagram[data-state="ready"]').first()).toBeVisible({ timeout: 60_000 })
  await expect(page.locator('figure.brd-diagram[data-state="error"]')).toHaveCount(0)
  await expect(page.locator('figure.brd-diagram svg').first()).toBeVisible()
})

test('Docs: the JavaScript the browser downloads contains no document text', async ({ page, request }) => {
  const tenant = await bootstrapTenant(request, 'DocsBundle')
  const scripts: string[] = []
  page.on('response', (res) => {
    const type = res.headers()['content-type'] ?? ''
    if (/javascript|typescript|text\/plain/.test(type) || /\.(m?js|tsx?)(\?|$)/.test(res.url())) {
      if (res.url().startsWith('http://localhost:5173')) scripts.push(res.url())
    }
  })
  await loginViaUi(page, tenant.tenantId, tenant.adminEmail, tenant.adminPassword)
  await page.goto('/brd/administrator-guide')
  await expect(page.locator('article h1').first()).toBeVisible()
  expect(scripts.length).toBeGreaterThan(5)
  for (const url of scripts) {
    const body = await (await request.get(url)).text()
    for (const sentinel of SENTINELS) expect(body.includes(sentinel), `${sentinel} found in ${url}`).toBe(false)
  }
  // The old static copies are gone: the dev server falls back to index.html.
  const old = await request.get('http://localhost:5173/src/content/docs/database-schema.md?raw')
  expect(await old.text()).not.toContain('Database Schema — QTestHub')
})
