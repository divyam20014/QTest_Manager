import { expect, request as pwRequest, test, type Page } from '@playwright/test'

import {
  API_BASE_URL,
  PLATFORM_ADMIN_EMAIL,
  PLATFORM_ADMIN_PASSWORD,
  createEnrolledThrowawayPlatformAdmin,
  createThrowawayPlatformAdmin,
  deactivateThrowawayPlatformAdmin,
  freshPlatformTotpCode,
  getPlatformSessionToken,
  platformAuthHeaders,
  totpCodeForStep,
  totpStep,
} from './fixtures'

// ADR-074: Platform Admin sign-in = password + authenticator code (TOTP), with
// single-use recovery codes. ADR-080: first-time enrolment also needs a
// one-time enrolment code. These specs drive the REAL UI against throwaway,
// un-enrolled platform admins created through the API, so the shared dev
// admin's MFA state is never touched.

const PASSWORD = 'PlatformMfaPass123!'
const unique = Date.now()
const EMAIL = `mfa-e2e-${unique}@example.com`

let secret = ''
let recoveryCodes: string[] = []
let lastStep = 0
let adminId = ''
let enrolmentCode = ''

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
  const created = await request.post(`${API_BASE_URL}/platform/admins?page_size=100`, {
    headers: platformAuthHeaders(token),
    data: { email: EMAIL, password: PASSWORD },
  })
  expect(created.ok(), await created.text()).toBeTruthy()
  const body = (await created.json()).data
  adminId = body.id
  enrolmentCode = body.enrolment_code
  expect(enrolmentCode).toMatch(/^[A-Z2-9]{5}(-[A-Z2-9]{5}){3}$/)
})

test.afterAll(async ({ request }) => {
  if (!adminId) return
  const token = await getPlatformSessionToken()
  await request.patch(`${API_BASE_URL}/platform/admins/${adminId}`, {
    headers: platformAuthHeaders(token),
    data: { is_active: false },
  })
})

test('a new platform admin must enrol an authenticator, then lands in the console', async ({
  page,
}) => {
  await signInWithPassword(page)

  // Password alone shows no QR code: the one-time enrolment code comes first.
  await expect(page.getByRole('heading', { name: 'Enter your enrolment code' })).toBeVisible()
  await expect(page.getByRole('img', { name: 'QR code for your authenticator app' })).toHaveCount(0)
  await expect(
    page.getByText('The code your administrator gave you, separate from your password'),
  ).toBeVisible()
  // A wrong code gets the generic error and still no QR code.
  await page.getByLabel('Enrolment code').fill('ZZZZZ-ZZZZZ-ZZZZZ-ZZZZZ')
  await page.getByRole('button', { name: 'Continue' }).click()
  await expect(page.getByRole('alert')).toContainText('Invalid or expired enrolment code')
  await expect(page.getByRole('img', { name: 'QR code for your authenticator app' })).toHaveCount(0)
  // The right one (lower-case, spaces: formatting is forgiving) unlocks setup.
  await page.getByLabel('Enrolment code').fill(enrolmentCode.toLowerCase().replace(/-/g, ' '))
  await page.getByRole('button', { name: 'Continue' }).click()

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

  const proceed = page.getByRole('button', {
    name: 'Continue to Platform Administration',
  })
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

// --- ADR-080: the enrolment code, end to end over the API -----------------------

interface PlatformApi {
  post: (path: string, data?: unknown) => Promise<{ status: number; body: any }>
  dispose: () => Promise<void>
}

/** A cookie-jar API client signed in with a password only (pre-MFA session). */
async function passwordOnlySession(email: string, password: string): Promise<PlatformApi> {
  const ctx = await pwRequest.newContext()
  const login = await ctx.post(`${API_BASE_URL}/platform/auth/login`, {
    data: { email, password },
  })
  expect(login.ok(), await login.text()).toBeTruthy()
  return {
    post: async (path, data) => {
      const res = await ctx.post(`${API_BASE_URL}${path}`, data === undefined ? {} : { data })
      return { status: res.status(), body: await res.json() }
    },
    dispose: () => ctx.dispose(),
  }
}

const START = '/platform/auth/mfa/enroll/start'
const FINISH = '/platform/auth/mfa/enroll/verify'
const GENERIC = 'Invalid or expired enrolment code'

test('enrolment needs the code: blocked without it and with a wrong one, re-issue replaces it, single use', async ({
  request,
}) => {
  const admin = await createThrowawayPlatformAdmin(request, 'mfa-e2e-code')
  try {
    const api = await passwordOnlySession(admin.email, admin.password)
    // No code at all: validation error, nothing issued.
    expect((await api.post(START, {})).status).toBe(422)
    // Wrong code: generic error.
    const wrong = await api.post(START, {
      enrolment_code: 'AAAAA-AAAAA-AAAAA-AAAAA',
    })
    expect(wrong.status).toBe(401)
    expect(wrong.body.error.message).toBe(GENERIC)
    // Completing needs the code too, even with an arbitrary authenticator code.
    const finishWrong = await api.post(FINISH, {
      code: '123456',
      enrolment_code: 'AAAAA-AAAAA-AAAAA-AAAAA',
    })
    expect(finishWrong.status).toBe(401)

    // Re-issue (as the owner) invalidates the first code.
    const token = await getPlatformSessionToken()
    const reissued = await request.post(
      `${API_BASE_URL}/platform/admins/${admin.id}/enrolment-code`,
      { headers: platformAuthHeaders(token) },
    )
    expect(reissued.ok(), await reissued.text()).toBeTruthy()
    const fresh: string = (await reissued.json()).data.enrolment_code
    expect(fresh).not.toBe(admin.enrolmentCode)
    const old = await api.post(START, { enrolment_code: admin.enrolmentCode })
    expect(old.status).toBe(401)
    expect(old.body.error.message).toBe(GENERIC)

    // The new one works, and the admin list never leaks the code or its hash.
    const started = await api.post(START, { enrolment_code: fresh })
    expect(started.status).toBe(200)
    const listing = await request.get(`${API_BASE_URL}/platform/admins?page_size=100`, {
      headers: platformAuthHeaders(token),
    })
    const listText = await listing.text()
    expect(listText).not.toContain(fresh)
    expect(listText).not.toContain('enrolment_code_hash')
    const row = (JSON.parse(listText).data.items as any[]).find((a) => a.id === admin.id)
    expect(row.enrolment_code_active).toBe(true)
    expect('enrolment_code' in row).toBe(false)

    const secretKey: string = started.body.data.secret
    const finished = await api.post(FINISH, {
      code: totpCodeForStep(secretKey, totpStep()),
      enrolment_code: fresh,
    })
    expect(finished.status).toBe(200)
    await api.dispose()

    // Single use: the consumed code is useless afterwards (account is enrolled).
    const again = await passwordOnlySession(admin.email, admin.password)
    expect((await again.post(START, { enrolment_code: fresh })).status).toBe(409)
    await again.dispose()
  } finally {
    await deactivateThrowawayPlatformAdmin(request, admin.id)
  }
})

test('wrong enrolment codes count towards the account lockout', async ({ request }) => {
  const admin = await createThrowawayPlatformAdmin(request, 'mfa-e2e-lock')
  try {
    const api = await passwordOnlySession(admin.email, admin.password)
    const messages: string[] = []
    for (let i = 0; i < 5; i++) {
      const res = await api.post(START, { enrolment_code: `BAD${i}` })
      expect(res.status).toBe(401)
      messages.push(res.body.error.message)
    }
    expect(messages.slice(0, 4)).toEqual(Array(4).fill(GENERIC))
    expect(messages[4].toLowerCase()).toContain('locked')
    await api.dispose()
    // Even the right code is refused while locked, and so is the password step.
    const ctx = await pwRequest.newContext()
    const login = await ctx.post(`${API_BASE_URL}/platform/auth/login`, {
      data: { email: admin.email, password: admin.password },
    })
    expect(login.status()).toBe(401)
    expect((await login.text()).toLowerCase()).toContain('locked')
    await ctx.dispose()
  } finally {
    await deactivateThrowawayPlatformAdmin(request, admin.id)
  }
})

test('the enrolment code step fits a phone, in light and dark', async ({ page, request }) => {
  const admin = await createThrowawayPlatformAdmin(request, 'mfa-e2e-shot')
  try {
    const shots = process.env.E2E_SHOTS_DIR
    for (const [width, height, scheme] of [
      [390, 844, 'light'],
      [390, 844, 'dark'],
      [1280, 800, 'light'],
    ] as const) {
      await page.setViewportSize({ width, height })
      await page.emulateMedia({ colorScheme: scheme })
      await page.goto('/platform-admin')
      await page.getByLabel('Email').fill(admin.email)
      await page.getByLabel('Password').fill(admin.password)
      await page.getByRole('button', { name: 'Sign in' }).click()
      await expect(page.getByRole('heading', { name: 'Enter your enrolment code' })).toBeVisible()
      const field = page.getByLabel('Enrolment code')
      await expect(field).toHaveAttribute('autocomplete', 'off')
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      )
      expect(overflow).toBeLessThanOrEqual(0)
      if (width < 768) {
        expect((await field.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44)
        expect(
          (await page.getByRole('button', { name: 'Continue' }).boundingBox())?.height ?? 0,
        ).toBeGreaterThanOrEqual(44)
      }
      if (shots)
        await page.screenshot({
          path: `${shots}/enrol-code-${width}-${scheme}.png`,
        })
      await page.getByRole('button', { name: 'Back to sign in' }).click()
    }
  } finally {
    await deactivateThrowawayPlatformAdmin(request, admin.id)
  }
})

test('the Admins tab shows a new code once, and re-issue shows another', async ({ page }) => {
  const shots = process.env.E2E_SHOTS_DIR
  await page.goto('/platform-admin')
  await page.getByLabel('Email').fill(PLATFORM_ADMIN_EMAIL)
  await page.getByLabel('Password').fill(PLATFORM_ADMIN_PASSWORD)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.getByLabel('Authentication code').fill(await freshPlatformTotpCode())
  await page.getByRole('button', { name: 'Verify' }).click()
  await page.getByRole('tab', { name: 'Platform Admins' }).click()

  const email = `mfa-e2e-ui-${Date.now()}@example.com`
  await page.getByRole('button', { name: 'New Admin' }).click()
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill('PlatformMfaPass123!')
  await page.getByRole('button', { name: 'Create Admin' }).click()

  const dialog = page.getByRole('dialog')
  const first = (await dialog.getByTestId('enrolment-code').textContent()) ?? ''
  expect(first).toMatch(/^[A-Z2-9]{5}(-[A-Z2-9]{5}){3}$/)
  await expect(dialog).toContainText('separately from their password')
  await expect(dialog).toContainText('expires in 24 hours')
  if (shots) await page.screenshot({ path: `${shots}/enrol-code-dialog-1280.png` })
  await page.setViewportSize({ width: 390, height: 844 })
  if (shots) {
    await page.waitForTimeout(6000) // let the 'created' toast clear
    await page.screenshot({ path: `${shots}/enrol-code-dialog-390.png` })
  }
  await page.setViewportSize({ width: 1280, height: 800 })
  await dialog.getByRole('button', { name: 'I have passed it on' }).click()
  await expect(page.getByText(first)).toHaveCount(0) // shown once, gone for good

  const row = page.getByRole('row', { name: new RegExp(email) })
  await expect(row).toContainText('Active until')
  await row.getByRole('button', { name: 'Re-issue enrolment code' }).click()
  await page.getByRole('button', { name: 'Issue new code' }).click()
  const second = (await page.getByRole('dialog').getByTestId('enrolment-code').textContent()) ?? ''
  expect(second).toMatch(/^[A-Z2-9]{5}(-[A-Z2-9]{5}){3}$/)
  expect(second).not.toBe(first)
  await page.getByRole('button', { name: 'I have passed it on' }).click()

  // Clean up: deactivate the throwaway admin.
  const token = await getPlatformSessionToken()
  const admins = await page.request.get(`${API_BASE_URL}/platform/admins?page_size=100`, {
    headers: platformAuthHeaders(token),
  })
  const created = ((await admins.json()).data.items as any[]).find((a) => a.email === email)
  if (created) {
    await page.request.patch(`${API_BASE_URL}/platform/admins/${created.id}`, {
      headers: platformAuthHeaders(token),
      data: { is_active: false },
    })
  }
})

// --- ADR-081: password change and admin-initiated reset -------------------------
// Every spec below uses throwaway admins only; the shared dev admin's password
// and authenticator are never changed.

const NEW_PASSWORD = 'BrandNewPass456!'

async function noHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
  expect(overflow).toBeLessThanOrEqual(0)
}

async function uiSignIn(
  page: Page,
  email: string,
  password: string,
  factor: { code: string } | { recovery: string },
) {
  await page.goto('/platform-admin')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('heading', { name: 'Two-step verification' })).toBeVisible()
  if ('recovery' in factor) {
    await page.getByRole('button', { name: 'Use a recovery code instead' }).click()
    await page.getByLabel('Recovery code').fill(factor.recovery)
  } else {
    await page.getByLabel('Authentication code').fill(factor.code)
  }
  await page.getByRole('button', { name: 'Verify' }).click()
  await expect(page.getByText(`Signed in as ${email}`)).toBeVisible()
}

test('Change password: validates, rejects a wrong current password, then switches the password', async ({
  page,
  request,
}) => {
  // Several waits for the next 30 s authenticator step add up.
  test.setTimeout(120_000)
  const admin = await createEnrolledThrowawayPlatformAdmin(request, 'pw-e2e-change')
  const shots = process.env.E2E_SHOTS_DIR
  try {
    await uiSignIn(page, admin.email, admin.password, {
      code: await admin.nextCode(),
    })

    await page.getByRole('button', { name: 'Change password' }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByLabel('Current password')).toBeVisible()
    await expect(dialog.getByLabel('Confirm new password')).toBeVisible()
    const submit = dialog.getByRole('button', { name: 'Change password' })
    await expect(submit).toBeDisabled()

    // Mismatched confirmation is flagged and cannot be submitted.
    await dialog.getByLabel('Current password').fill(admin.password)
    await dialog.getByLabel('New password', { exact: true }).fill(NEW_PASSWORD)
    await dialog.getByLabel('Confirm new password').fill('SomethingElse789!')
    await expect(dialog.getByRole('alert')).toContainText('do not match')
    await dialog.getByLabel('Authentication code').fill('123456')
    await expect(submit).toBeDisabled()
    await dialog.getByLabel('Confirm new password').fill(NEW_PASSWORD)
    if (shots) await page.screenshot({ path: `${shots}/change-password-1280.png` })
    await page.setViewportSize({ width: 390, height: 844 })
    await noHorizontalOverflow(page)
    expect(
      (await dialog.getByLabel('Current password').boundingBox())?.height ?? 0,
    ).toBeGreaterThanOrEqual(44)
    if (shots) await page.screenshot({ path: `${shots}/change-password-390.png` })
    await page.setViewportSize({ width: 1280, height: 800 })

    // A wrong current password is refused (and counts toward the lockout).
    await dialog.getByLabel('Current password').fill('WrongCurrent123!')
    await submit.click()
    await expect(dialog.getByRole('alert')).toContainText('incorrect')

    // Correct current password + a recovery code succeeds.
    await dialog.getByRole('button', { name: 'Use a recovery code instead' }).click()
    await dialog.getByLabel('Current password').fill(admin.password)
    await dialog.getByLabel('New password', { exact: true }).fill(NEW_PASSWORD)
    await dialog.getByLabel('Confirm new password').fill(NEW_PASSWORD)
    await dialog.getByLabel('Recovery code').fill(admin.recoveryCodes[0])
    await submit.click()
    await expect(page.getByText(/Password changed/)).toBeVisible()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    // The current session stays signed in.
    await expect(page.getByText(`Signed in as ${admin.email}`)).toBeVisible()

    // The old password no longer signs in; the new one does.
    await page.getByRole('button', { name: 'Sign out' }).click()
    await page.getByLabel('Email').fill(admin.email)
    await page.getByLabel('Password').fill(admin.password)
    await page.getByRole('button', { name: 'Sign in' }).click()
    await expect(page.getByRole('alert')).toContainText('Invalid platform admin credentials')
    await uiSignIn(page, admin.email, NEW_PASSWORD, {
      recovery: admin.recoveryCodes[1],
    })
  } finally {
    await deactivateThrowawayPlatformAdmin(request, admin.id)
  }
})

test('Password reset: another admin issues a code once, the target signs in only through the reset flow', async ({
  page,
  browser,
  request,
}) => {
  // Several waits for the next 30 s authenticator step add up.
  test.setTimeout(120_000)
  const actor = await createEnrolledThrowawayPlatformAdmin(request, 'pw-e2e-actor')
  const target = await createEnrolledThrowawayPlatformAdmin(request, 'pw-e2e-target')
  const shots = process.env.E2E_SHOTS_DIR
  try {
    await uiSignIn(page, actor.email, actor.password, {
      code: await actor.nextCode(),
    })
    await page.getByRole('tab', { name: 'Platform Admins' }).click()

    // Not offered on your own row.
    const own = page.getByRole('row', { name: new RegExp(actor.email) })
    await expect(own).toBeVisible()
    await expect(own.getByRole('button', { name: 'Issue password reset code' })).toHaveCount(0)

    const row = page.getByRole('row', { name: new RegExp(target.email) })
    await expect(row).not.toContainText('Reset code active')
    await row.getByRole('button', { name: 'Issue password reset code' }).click()
    await page.getByRole('button', { name: 'Issue reset code' }).click()
    const dialog = page.getByRole('dialog')
    const code = (await dialog.getByTestId('password-reset-code').textContent()) ?? ''
    expect(code).toMatch(/^[A-Z2-9]{5}(-[A-Z2-9]{5}){3}$/)
    await expect(dialog).toContainText('shown only once')
    await expect(dialog).toContainText('expires in 24 hours')
    if (shots) await page.screenshot({ path: `${shots}/reset-code-dialog-1280.png` })
    await dialog.getByRole('button', { name: 'I have passed it on' }).click()
    await expect(page.getByText(code)).toHaveCount(0) // shown once, gone for good
    await expect(row).toContainText('Reset code active until')
    if (shots) await page.screenshot({ path: `${shots}/admins-tab-1280.png` })
    await page.setViewportSize({ width: 390, height: 844 })
    await noHorizontalOverflow(page)
    if (shots) await page.screenshot({ path: `${shots}/admins-tab-390.png`, fullPage: true })
    await page.setViewportSize({ width: 1280, height: 800 })

    // The target uses a separate browser context (their own cookies).
    const context = await browser.newContext()
    const tpage = await context.newPage()
    try {
      await tpage.goto('/platform-admin')
      await tpage.getByLabel('Email').fill(target.email)
      await tpage.getByLabel('Password').fill(target.password)
      await tpage.getByRole('button', { name: 'Sign in' }).click()
      await expect(tpage.getByRole('alert')).toContainText('reset is pending')

      await tpage.getByRole('button', { name: 'Have a reset code?' }).click()
      await expect(tpage.getByRole('heading', { name: 'Reset your password' })).toBeVisible()
      await tpage.getByLabel('Email').fill(target.email)
      await tpage.getByLabel('Reset code').fill('ZZZZZ-ZZZZZ-ZZZZZ-ZZZZZ')
      await tpage.getByLabel('New password', { exact: true }).fill(NEW_PASSWORD)
      await tpage.getByLabel('Confirm new password').fill(NEW_PASSWORD)
      await tpage.getByLabel(/Authentication code/).fill(await target.nextCode())
      await tpage.getByRole('button', { name: 'Set new password' }).click()
      await expect(tpage.getByRole('alert')).toContainText('Invalid or expired reset code')

      await tpage.setViewportSize({ width: 390, height: 844 })
      await noHorizontalOverflow(tpage)
      expect(
        (await tpage.getByLabel('Reset code').boundingBox())?.height ?? 0,
      ).toBeGreaterThanOrEqual(44)
      if (shots) await tpage.screenshot({ path: `${shots}/reset-flow-390.png` })
      await tpage.setViewportSize({ width: 1280, height: 800 })

      // The right code (forgiving format) + the authenticator code completes it.
      await tpage.getByLabel('Reset code').fill(code.toLowerCase().replace(/-/g, ' '))
      await tpage.getByLabel(/Authentication code/).fill(await target.nextCode())
      await tpage.getByRole('button', { name: 'Set new password' }).click()
      await expect(tpage.getByRole('status')).toContainText('Password updated')

      // Then a normal sign-in with the new password works; the code is spent.
      await uiSignIn(tpage, target.email, NEW_PASSWORD, {
        recovery: target.recoveryCodes[0],
      })
    } finally {
      await context.close()
    }
  } finally {
    await deactivateThrowawayPlatformAdmin(request, actor.id)
    await deactivateThrowawayPlatformAdmin(request, target.id)
  }
})

test('Audit tab: shows the sign-in events of a throwaway admin and the chain verifies', async ({
  page,
  request,
}) => {
  test.setTimeout(90_000)
  const admin = await createEnrolledThrowawayPlatformAdmin(request, 'audit-e2e')
  const shots = process.env.E2E_SHOTS_DIR
  try {
    await uiSignIn(page, admin.email, admin.password, { code: await admin.nextCode() })
    await page.getByRole('tab', { name: 'Audit' }).click()

    const table = page.getByRole('table', { name: 'Platform audit events' })
    await expect(table).toContainText('Login password ok')
    await expect(table).toContainText('Mfa success')

    // Filter by actor: only this admin's rows remain.
    await page.getByLabel('Actor email').fill(admin.email)
    await expect(table).toContainText(admin.email)
    await page.getByLabel('Outcome').selectOption('failure')
    await expect(page.getByText('No audit events match these filters.')).toBeVisible()
    await page.getByLabel('Outcome').selectOption('')

    await page.getByRole('button', { name: 'Verify chain' }).click()
    await expect(page.getByTestId('audit-verify-result')).toContainText('Chain verified')

    if (shots) await page.screenshot({ path: `${shots}/audit-tab-1280.png` })
    await page.setViewportSize({ width: 390, height: 844 })
    await noHorizontalOverflow(page)
    if (shots) await page.screenshot({ path: `${shots}/audit-tab-390.png`, fullPage: true })
    await page.setViewportSize({ width: 1280, height: 800 })
  } finally {
    await deactivateThrowawayPlatformAdmin(request, admin.id)
  }
})
