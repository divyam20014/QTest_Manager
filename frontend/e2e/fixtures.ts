import type { APIRequestContext, Page } from '@playwright/test'

export const API_BASE_URL = process.env.E2E_API_BASE_URL ?? 'http://localhost:8000/api/v1'

// Platform-admin provisioning is deliberately out-of-band (not exposed over
// HTTP, see backend/scripts/seed_platform_admin.py) -- before running this
// suite, seed one with:
//   docker compose exec api python -m scripts.seed_platform_admin \
//     --email owner@qtesthub.local --password Sup3rSecret1Pass
const PLATFORM_ADMIN_EMAIL = process.env.E2E_PLATFORM_ADMIN_EMAIL ?? 'owner@qtesthub.local'
const PLATFORM_ADMIN_PASSWORD = process.env.E2E_PLATFORM_ADMIN_PASSWORD ?? 'Sup3rSecret1Pass'

export interface SeededTenant {
  tenantId: string
  adminEmail: string
  adminPassword: string
}

let counter = 0

/** Bootstraps a fresh, uniquely-named tenant + its first Admin user via the
 * platform API, so every spec file runs against isolated data instead of
 * sharing state (and colliding on unique constraints like project names
 * or emails) with every other spec. */
export async function bootstrapTenant(
  request: APIRequestContext,
  namePrefix: string,
): Promise<SeededTenant> {
  counter += 1
  const unique = `${Date.now()}-${counter}`
  const adminEmail = `admin-${namePrefix.toLowerCase()}-${unique}@example.com`
  const adminPassword = 'AdminPassw0rd1!'

  const response = await request.post(`${API_BASE_URL}/platform/tenants`, {
    headers: {
      Authorization:
        'Basic ' + Buffer.from(`${PLATFORM_ADMIN_EMAIL}:${PLATFORM_ADMIN_PASSWORD}`).toString('base64'),
    },
    data: {
      tenant_name: `${namePrefix} ${unique}`,
      admin_name: 'Admin E2E',
      admin_email: adminEmail,
      admin_password: adminPassword,
    },
  })
  if (!response.ok()) {
    throw new Error(
      `Tenant bootstrap failed (${response.status()}): ${await response.text()}. ` +
        'Has the platform admin been seeded? See the comment at the top of e2e/fixtures.ts.',
    )
  }
  const body = await response.json()
  return { tenantId: body.data.tenant.id, adminEmail, adminPassword }
}

export async function loginViaUi(
  page: Page,
  tenantId: string,
  email: string,
  password: string,
): Promise<void> {
  await page.goto('/')
  await page.waitForSelector('text=Sign in to your organization')
  await page.fill('#tenant_id', tenantId)
  await page.fill('#email', email)
  await page.fill('#password', password)
  // Tier 4 / ADR-054: a valid-looking tenant id also renders a separate
  // "Sign in with SSO" button -- scoped to the submit button specifically
  // so this doesn't hit a strict-mode ambiguity between the two.
  await page.click('button[type="submit"]:has-text("Sign in")')
  await page.waitForSelector('text=Enter your verification code')
  const bodyText = await page.textContent('body')
  const match = bodyText?.match(/Dev mode code:\s*(\d{6})/)
  if (!match) throw new Error('Dev-mode MFA code not found on verification screen')
  await page.fill('#code', match[1])
  await page.click('button:has-text("Verify")')
  await page.waitForSelector('h1:has-text("Dashboard")')
}
