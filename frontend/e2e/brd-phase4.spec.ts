import { expect, test, type Page, type Route } from '@playwright/test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { API_BASE_URL, bootstrapTenant, loginViaUi, nativeSelect } from './fixtures'

// BRD gap plan, Phase 4 (ADR-072, ADR-073): the optional insurance domain on sign-up /
// settings / new-project default, and the in-app Documentation viewer (/brd).
// Every test uses its own throwaway tenant or mocks the network.

async function fulfillCors(route: Route, json: unknown, status = 200) {
  const req = route.request()
  const headers: Record<string, string> = {
    'access-control-allow-origin': req.headers()['origin'] ?? '*',
    'access-control-allow-credentials': 'true',
    'access-control-allow-headers': req.headers()['access-control-request-headers'] ?? '*',
    'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
  }
  if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers })
  return route.fulfill({ status, headers, json: { data: json, error: null } })
}

async function createTester(request: import('@playwright/test').APIRequestContext, tenant: Awaited<ReturnType<typeof bootstrapTenant>>) {
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

// ---------------------------------------------------------------- sign-up domain

test('Signup: the insurance domain is an optional dropdown and is sent when chosen', async ({ page }) => {
  let payload: Record<string, unknown> | null = null
  await page.route('**/api/v1/auth/signup', async (route) => {
    if (route.request().method() === 'POST') payload = route.request().postDataJSON()
    return fulfillCors(route, { tenant: { id: 't1', name: 'Mock Co' }, admin_user_id: 'u1' })
  })

  await page.goto('/signup')
  const domain = nativeSelect(page, /Insurance Domain/)
  await expect(domain).toBeVisible()
  await expect(domain).not.toHaveAttribute('required', '')
  const options = await domain.locator('option').allTextContents()
  expect(options).toEqual(['Not specified', 'Motor', 'Health', 'Travel', 'Life', 'Property', 'Other / multiple'])

  await page.getByLabel('Organization Name').fill('Mock Insurance Co')
  await page.getByLabel('Your Name').fill('Jamie Founder')
  await page.getByLabel('Work Email').fill('founder@mock-insurance.example')
  await page.getByLabel('Password').fill('FoundingAdmin1!')
  await domain.selectOption('Health')
  await page.getByRole('button', { name: 'Create Account' }).click()
  await expect(page.getByText('Account created')).toBeVisible()
  expect(payload).toMatchObject({ tenant_name: 'Mock Insurance Co', primary_domain: 'Health' })
})

test('Signup: leaving the domain unset sends no primary_domain', async ({ page }) => {
  let payload: Record<string, unknown> | null = null
  await page.route('**/api/v1/auth/signup', async (route) => {
    if (route.request().method() === 'POST') payload = route.request().postDataJSON()
    return fulfillCors(route, { tenant: { id: 't1', name: 'Mock Co' }, admin_user_id: 'u1' })
  })
  await page.goto('/signup')
  await page.getByLabel('Organization Name').fill('No Domain Co')
  await page.getByLabel('Your Name').fill('Jamie Founder')
  await page.getByLabel('Work Email').fill('founder@no-domain.example')
  await page.getByLabel('Password').fill('FoundingAdmin1!')
  await page.getByRole('button', { name: 'Create Account' }).click()
  await expect(page.getByText('Account created')).toBeVisible()
  expect(payload).not.toBeNull()
  expect(payload).not.toHaveProperty('primary_domain')
})

test('Settings: an Admin sets the domain, and New Project pre-selects it; "Other" keeps the default', async ({
  page,
  request,
}) => {
  const tenant = await bootstrapTenant(request, 'BrdDomain')
  await loginViaUi(page, tenant.tenantId, tenant.adminEmail, tenant.adminPassword)

  await page.goto('/settings')
  const select = nativeSelect(page, 'Primary Insurance Domain')
  await expect(select).toHaveValue('')
  await select.selectOption('Property')
  await page.getByRole('button', { name: 'Save Changes' }).first().click()
  await expect(page.getByText('Organization settings saved')).toBeVisible()

  await page.goto('/projects')
  await page.getByRole('button', { name: /New Project/ }).click()
  await expect(nativeSelect(page.getByRole('dialog'), /^Domain/)).toHaveValue('Property')
  await page.keyboard.press('Escape')

  // "Other / multiple" has no matching project domain, so the default stays.
  await page.goto('/settings')
  await nativeSelect(page, 'Primary Insurance Domain').selectOption('Other')
  await page.getByRole('button', { name: 'Save Changes' }).first().click()
  await expect(page.getByText('Organization settings saved')).toBeVisible()
  await page.goto('/projects')
  await page.getByRole('button', { name: /New Project/ }).click()
  await expect(nativeSelect(page.getByRole('dialog'), /^Domain/)).toHaveValue('Motor')
})

// ---------------------------------------------------------------- documentation viewer

test('Docs: /brd opens the user guide with a table of contents and the reader indicator', async ({ page, request }) => {
  const tenant = await bootstrapTenant(request, 'BrdDocs')
  await loginViaUi(page, tenant.tenantId, tenant.adminEmail, tenant.adminPassword)

  await page.goto('/brd')
  await expect(page).toHaveURL(/\/brd\/user-guide$/)
  await expect(page.getByRole('heading', { level: 1, name: 'Documentation' })).toBeVisible()
  await expect(page.locator('article h1').first()).toContainText('User Guide')
  await expect(page.getByTestId('brd-reader')).toContainText('Reading as Admin E2E')
  await expect(page.getByTestId('brd-reader')).toContainText('Admin')

  const toc = page.getByRole('navigation', { name: 'On this page' })
  await expect(toc.getByRole('link').first()).toBeVisible()
  // Following a TOC link moves the page and marks it as the current section.
  const second = toc.getByRole('link').nth(1)
  const target = (await second.getAttribute('href'))!.slice(1)
  await second.click()
  await expect(page.locator(`[id="${target}"]`)).toBeInViewport()
  await expect(second).toHaveAttribute('aria-current', 'location')

  // The sidebar has a Documentation entry for every signed-in user.
  await expect(page.getByRole('complementary', { name: 'Sidebar' }).getByRole('link', { name: 'Documentation' })).toBeVisible()
  // Breadcrumb names the document.
  await expect(page.getByRole('navigation', { name: 'Breadcrumb' })).toContainText('User Guide')
})

test('Docs: Copy Markdown, Download .md and Print / PDF work', async ({ page, context, request }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  const tenant = await bootstrapTenant(request, 'BrdDocUtil')
  await loginViaUi(page, tenant.tenantId, tenant.adminEmail, tenant.adminPassword)
  await page.goto('/brd/test-strategy')
  await expect(page.locator('article h1').first()).toBeVisible()

  await page.getByRole('button', { name: /Copy Markdown/ }).click()
  await expect(page.getByText('Markdown copied to the clipboard')).toBeVisible()
  const clip = await page.evaluate(() => navigator.clipboard.readText())
  expect(clip.startsWith('# QTestHub')).toBe(true)

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: /Download \.md/ }).click(),
  ])
  expect(download.suggestedFilename()).toBe('TEST_STRATEGY.md')

  await page.evaluate(() => {
    ;(window as unknown as { __printed: number }).__printed = 0
    window.print = () => {
      ;(window as unknown as { __printed: number }).__printed += 1
    }
  })
  await page.getByRole('button', { name: /Print \/ PDF/ }).click()
  expect(await page.evaluate(() => (window as unknown as { __printed: number }).__printed)).toBe(1)
})

// The 27 fenced diagrams live in six documents (the overview has none).
const DIAGRAM_DOCS: [string, number][] = [
  ['data-flow-diagrams', 6],
  ['entity-relationship', 3],
  ['process-flows', 6],
  ['sequence-diagrams', 9],
  ['system-architecture', 1],
  ['use-cases', 2],
]

for (const theme of ['light', 'dark'] as const) {
  test(`Docs: every Mermaid diagram in the architecture documents renders (${theme})`, async ({ page, request }) => {
    test.setTimeout(240_000)
    const tenant = await bootstrapTenant(request, 'BrdDiagrams')
    await page.addInitScript((t) => localStorage.setItem('qtesthub:theme', t), theme)
    await loginViaUi(page, tenant.tenantId, tenant.adminEmail, tenant.adminPassword)
    for (const [id, count] of DIAGRAM_DOCS) {
      await page.goto(`/brd/${id}`)
      const figures = page.locator('figure.brd-diagram')
      await expect(figures).toHaveCount(count)
      await expect(page.locator('figure.brd-diagram[data-state="ready"]')).toHaveCount(count, { timeout: 60_000 })
      await expect(page.locator('figure.brd-diagram[data-state="error"]')).toHaveCount(0)
      // Each picture is a real SVG with content, and the source stays available as text.
      const svgs = page.locator('figure.brd-diagram svg')
      await expect(svgs).toHaveCount(count)
      expect(await svgs.first().evaluate((el) => el.getBoundingClientRect().width)).toBeGreaterThan(50)
      await expect(page.locator('figure.brd-diagram details summary').first()).toHaveText('Diagram source')
    }
  })
}

test('Docs: a Tester sees only the user-facing documents; internal ones show "No access"', async ({ page, request }) => {
  const tenant = await bootstrapTenant(request, 'BrdDocRoles')
  const tester = await createTester(request, tenant)
  await loginViaUi(page, tenant.tenantId, tester.email, tester.password)

  await page.goto('/brd')
  await expect(page).toHaveURL(/\/brd\/user-guide$/)
  await expect(page.locator('article h1').first()).toContainText('User Guide')

  const docsNav = page.getByRole('navigation', { name: 'Documents' })
  // ADR-089: the API lists only the general documents (5 product + 7 diagram).
  await expect(docsNav.getByRole('link')).toHaveCount(12)
  await expect(docsNav.getByRole('link', { name: 'Product Vision' })).toBeVisible()
  await expect(docsNav.getByRole('link', { name: 'Database Schema' })).toHaveCount(0)

  await page.goto('/brd/database-schema')
  await expect(page.getByRole('heading', { name: /don.t have access/i })).toBeVisible()
  await expect(page.locator('article')).toHaveCount(0)
  await page.goto('/brd/administrator-guide')
  await expect(page.getByRole('heading', { name: /don.t have access/i })).toBeVisible()

  // An unknown document is a "not found" message, not a crash.
  await page.goto('/brd/no-such-doc')
  await expect(page.getByText('Document not found')).toBeVisible()
})

test('Docs: raw HTML in a document is never executed and links stay safe', async ({ page, request }) => {
  const tenant = await bootstrapTenant(request, 'BrdDocSafe')
  await loginViaUi(page, tenant.tenantId, tenant.adminEmail, tenant.adminPassword)
  const dialogs: string[] = []
  page.on('dialog', (d) => {
    dialogs.push(d.message())
    void d.dismiss()
  })
  await page.goto('/brd/api-specification')
  await expect(page.locator('article h1').first()).toBeVisible()
  expect(dialogs).toEqual([])
  expect(await page.locator('article script, article iframe, article [onerror], article [onclick]').count()).toBe(0)
  // Every external link opens in a new tab without leaking the opener.
  const external = page.locator('article a[href^="http"]')
  for (const link of await external.all()) {
    await expect(link).toHaveAttribute('rel', /noopener/)
    await expect(link).toHaveAttribute('target', '_blank')
  }
  // No link in the document points at a path that would 404 (a .md/.mmd/.py file).
  const hrefs = await page.locator('article a[href]').evaluateAll((els) => els.map((e) => e.getAttribute('href') ?? ''))
  expect(hrefs.filter((h) => /\.(py|mmd|tsx?|sql)(#|$)/.test(h))).toEqual([])
})

// ---------------------------------------------------------------- the 27 standalone diagram sources

test('All 27 standalone Mermaid sources in docs/architecture/diagrams render with the bundled Mermaid', async ({
  page,
}) => {
  test.setTimeout(240_000)
  const dir = join(process.cwd(), '..', 'docs', 'architecture', 'diagrams')
  const files = readdirSync(dir).filter((f) => f.endsWith('.mmd'))
  expect(files.length).toBe(27)

  await page.setContent('<!doctype html><html><body></body></html>')
  await page.addScriptTag({ path: join(process.cwd(), 'node_modules', 'mermaid', 'dist', 'mermaid.min.js') })
  const sources = files.map((f) => ({ name: f, text: readFileSync(join(dir, f), 'utf8') }))
  const results = await page.evaluate(async (items) => {
    const mermaid = (window as unknown as { mermaid: { initialize: (c: object) => void; render: (id: string, t: string) => Promise<{ svg: string }> } }).mermaid
    mermaid.initialize({ startOnLoad: false, securityLevel: 'strict' })
    const out: { name: string; ok: boolean; error?: string; length: number }[] = []
    let i = 0
    for (const item of items) {
      try {
        const { svg } = await mermaid.render(`d${i++}`, item.text)
        out.push({ name: item.name, ok: svg.includes('<svg'), length: svg.length })
      } catch (e) {
        out.push({ name: item.name, ok: false, error: String((e as Error).message).split('\n')[0], length: 0 })
      }
    }
    return out
  }, sources)
  const failed = results.filter((r) => !r.ok)
  expect(failed, JSON.stringify(failed)).toEqual([])
  expect(results.every((r) => r.length > 500)).toBe(true)
})

// ---------------------------------------------------------------- layout

async function overflow(page: Page) {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
}

test('Docs: the viewer fits at phone and desktop widths with no sideways page scroll', async ({ page, request }) => {
  test.setTimeout(180_000)
  const tenant = await bootstrapTenant(request, 'BrdDocLayout')
  await loginViaUi(page, tenant.tenantId, tenant.adminEmail, tenant.adminPassword)
  for (const [width, height] of [
    [390, 844],
    [768, 1024],
    [1280, 800],
  ] as const) {
    await page.setViewportSize({ width, height })
    for (const id of ['user-guide', 'api-specification', 'database-schema', 'sequence-diagrams']) {
      await page.goto(`/brd/${id}`)
      await expect(page.locator('article h1').first()).toBeVisible()
      expect(await overflow(page), `${id} at ${width}px`).toBeLessThanOrEqual(0)
    }
  }
})
