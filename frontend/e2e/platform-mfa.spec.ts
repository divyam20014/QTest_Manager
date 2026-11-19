import { expect, test, type Page } from '@playwright/test'

import { API_BASE_URL, getPlatformSessionToken, totpCodeForStep, totpStep } from './fixtures'

// ADR-074: Platform Admin sign-in = password + authenticator code (TOTP), with
// single-use recovery codes. These specs drive the REAL UI against a
// throwaway, un-enrolled platform admin created through the API, so the shared
// dev admin's MFA state is never touched.

const PASSWORD = 'PlatformMfaPass123!'
const unique = Date.now()
const EMAIL = `mfa-e2e-${unique}@example.com`

let secret = ''
let recoveryCodes: string[] = []
let lastStep = 0
let adminId = ''

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** A code the server will accept: the newest step in the +-1 window that is
 * newer than any step this admin has already used (waits for the next 30 s
 * boundary when none is left). */
async function nextCode(): Promise<string> {
  for (;;) {
    const now = totpStep()
    const candidate = Math.max(now, lastStep + 1)
    if (candidate <= now + 1) {
      lastStep = candidate
      return totpCodeForStep(secret, candidate)
    }
    await sleep((now + 1) * 30_000 - Date.now() + 250)
  }
}

async function signInWithPassword(page: Page) {
  await page.goto('/platform-admin')
  await page.getByLabel('Email').fill(EMAIL)
  await page.getByLabel('Password').fill(PASSWORD)
  await page.getByRole('button', { name: 'Sign in' }).click()
}

test.describe.configure({ mode: 'serial' })

test.beforeAll(async ({ request }) => {
  const token = await getPlatformSessionToken()
  const created = await request.post(`${API_BASE_URL}/platform/admins`, {
    headers: { Cookie: `qth_platform_session=${token}` },
    data: { email: EMAIL, password: PASSWORD },
  })
  expect(created.ok(), await created.text()).toBeTruthy()
  adminId = (await created.json()).data.id
})

test.afterAll(async ({ request }) => {
  if (!adminId) return
  const token = await getPlatformSessionToken()
  await request.patch(`${API_BASE_URL}/platform/admins/${adminId}`, {
    headers: { Cookie: `qth_platform_session=${token}` },
    data: { is_active: false },
  })
})

test('a new platform admin must enrol an authenticator, then lands in the console', async ({
  page,
}) => {
  await signInWithPassword(page)

  await expect(page.getByRole('heading', { name: 'Set up two-step verification' })).toBeVisible()
  await expect(page.getByRole('img', { name: 'QR code for your authenticator app' })).toBeVisible()
  secret = (await page.getByLabel('Setup key (manual entry)').inputValue()).replace(/\s/g, '')
  expect(secret).toMatch(/^[A-Z2-7]{32}$/)

  // A wrong code is refused and does not enable MFA.
  await page.getByLabel('Authentication code').fill('000000')
  await page.getByRole('button', { name: 'Verify and enable' }).click()
  await expect(page.getByRole('alert')).toContainText('Invalid verification code')

  await page.getByLabel('Authentication code').fill(await nextCode())
  await page.getByRole('button', { name: 'Verify and enable' }).click()

  await expect(page.getByRole('heading', { name: 'Save your recovery codes' })).toBeVisible()
  const items = page.getByRole('list', { name: 'Recovery codes' }).getByRole('listitem')
  await expect(items).toHaveCount(10)
  recoveryCodes = await items.allTextContents()
  expect(new Set(recoveryCodes).size).toBe(10)

  const proceed = page.getByRole('button', { name: 'Continue to Platform Administration' })
  await expect(proceed).toBeDisabled()
  await page.getByLabel('I have saved these recovery codes somewhere safe.').check()
  await proceed.click()

  await expect(page.getByText(`Signed in as ${EMAIL}`)).toBeVisible()
  await expect(page.getByRole('tab', { name: 'Tenants' })).toBeVisible()
})

test('signing in again needs the authenticator code; a wrong code is refused', async ({ page }) => {
  await signInWithPassword(page)
  await expect(page.getByRole('heading', { name: 'Two-step verification' })).toBeVisible()

  await page.getByLabel('Authentication code').fill('000000')
  await page.getByRole('button', { name: 'Verify' }).click()
  await expect(page.getByRole('alert')).toContainText('Invalid verification code')

  await page.getByLabel('Authentication code').fill(await nextCode())
  await page.getByRole('button', { name: 'Verify' }).click()
  await expect(page.getByText(`Signed in as ${EMAIL}`)).toBeVisible()
})

test('a recovery code signs in once and cannot be reused', async ({ page }) => {
  await signInWithPassword(page)
  await page.getByRole('button', { name: 'Use a recovery code instead' }).click()
  await page.getByLabel('Recovery code').fill(recoveryCodes[0])
  await page.getByRole('button', { name: 'Verify' }).click()
  await expect(page.getByText(`Signed in as ${EMAIL}`)).toBeVisible()

  await page.getByRole('button', { name: 'Sign out' }).click()
  await expect(page.getByRole('heading', { name: 'Platform Administration' })).toBeVisible()

  await signInWithPassword(page)
  await page.getByRole('button', { name: 'Use a recovery code instead' }).click()
  await page.getByLabel('Recovery code').fill(recoveryCodes[0])
  await page.getByRole('button', { name: 'Verify' }).click()
  await expect(page.getByRole('alert')).toContainText('Invalid verification code')
})

test('sign-out ends the session, and a lost session returns to the sign-in form', async ({
  page,
  context,
}) => {
  await signInWithPassword(page)
  await page.getByRole('button', { name: 'Use a recovery code instead' }).click()
  await page.getByLabel('Recovery code').fill(recoveryCodes[1])
  await page.getByRole('button', { name: 'Verify' }).click()
  await expect(page.getByText(`Signed in as ${EMAIL}`)).toBeVisible()

  // A reload keeps the session (HttpOnly cookie, no credentials in the page).
  await page.reload()
  await expect(page.getByText(`Signed in as ${EMAIL}`)).toBeVisible()

  // The session is gone (expired/revoked): drop the cookie, so the next API call is a real 401.
  await context.clearCookies()
  await page.getByRole('tab', { name: 'Leads' }).click()
  await expect(page.getByRole('heading', { name: 'Platform Administration' })).toBeVisible()
  await expect(page.getByLabel('Password')).toBeVisible()

  // Sign out for real: the cookie no longer opens the API.
  await signInWithPassword(page)
  await page.getByRole('button', { name: 'Use a recovery code instead' }).click()
  await page.getByLabel('Recovery code').fill(recoveryCodes[2])
  await page.getByRole('button', { name: 'Verify' }).click()
  await expect(page.getByText(`Signed in as ${EMAIL}`)).toBeVisible()
  const cookies = await context.cookies()
  const session = cookies.find((c) => c.name === 'qth_platform_session')
  expect(session?.httpOnly).toBe(true)
  expect(session?.sameSite).toBe('Strict')
  await page.getByRole('button', { name: 'Sign out' }).click()
  await expect(page.getByLabel('Password')).toBeVisible()
  const after = await page.request.get(`${API_BASE_URL}/platform/tenants`)
  expect(after.status()).toBe(401)
})

test('the sign-in steps fit a phone screen', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await signInWithPassword(page)
  await expect(page.getByRole('heading', { name: 'Two-step verification' })).toBeVisible()
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
  expect(overflow).toBeLessThanOrEqual(0)
  const box = await page.getByRole('button', { name: 'Verify' }).boundingBox()
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(40)
})
