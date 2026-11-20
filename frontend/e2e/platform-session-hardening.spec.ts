import { expect, request as pwRequest, test, type Page } from '@playwright/test'

import {
  API_BASE_URL,
  createEnrolledThrowawayPlatformAdmin,
  createThrowawayPlatformAdmin,
  deactivateThrowawayPlatformAdmin,
  expireSessionIdle,
  ageSessionStepUp,
  type EnrolledThrowawayPlatformAdmin,
} from './fixtures'

// ADR-083: Platform Admin session hardening in the REAL console -- the step-up
// prompt that appears when a sensitive action needs a fresh authenticator code,
// the "My sessions" dialog, and the idle-timeout message. Throwaway admins only
// (never the shared dev admin), deactivated at the end of each test.

async function uiSignIn(page: Page, admin: EnrolledThrowawayPlatformAdmin) {
  await page.goto('/platform-admin')
  await page.getByLabel('Email').fill(admin.email)
  await page.getByLabel('Password').fill(admin.password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('heading', { name: 'Two-step verification' })).toBeVisible()
  await page.getByLabel('Authentication code').fill(await admin.nextCode())
  await page.getByRole('button', { name: 'Verify' }).click()
  await expect(page.getByText(`Signed in as ${admin.email}`)).toBeVisible()
}

/** A second, API-only session for the same admin (as another browser would have). */
async function apiSignIn(admin: EnrolledThrowawayPlatformAdmin): Promise<string> {
  const ctx = await pwRequest.newContext({
    userAgent: 'qth-e2e-second-device',
  })
  try {
    const login = await ctx.post(`${API_BASE_URL}/platform/auth/login`, {
      data: { email: admin.email, password: admin.password },
    })
    expect(login.ok(), await login.text()).toBeTruthy()
    const pre = /qth_platform_session=([^;,\s]+)/.exec(login.headers()['set-cookie'] ?? '')?.[1]
    expect(pre).toBeTruthy()
    const verify = await ctx.post(`${API_BASE_URL}/platform/auth/mfa/verify`, {
      data: { code: await admin.nextCode() },
      headers: { Cookie: `qth_platform_session=${pre}` },
    })
    expect(verify.ok(), await verify.text()).toBeTruthy()
    const full = /qth_platform_session=([^;,\s]+)/.exec(verify.headers()['set-cookie'] ?? '')?.[1]
    expect(full).toBeTruthy()
    return full as string
  } finally {
    await ctx.dispose()
  }
}

async function secondDeviceStatus(token: string): Promise<number> {
  const ctx = await pwRequest.newContext({
    userAgent: 'qth-e2e-second-device',
  })
  try {
    const res = await ctx.get(`${API_BASE_URL}/platform/auth/me`, {
      headers: { Cookie: `qth_platform_session=${token}` },
    })
    return res.status()
  } finally {
    await ctx.dispose()
  }
}

async function noHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
  expect(overflow).toBeLessThanOrEqual(0)
}

test('a sensitive action asks for an authenticator code, then retries itself', async ({
  page,
  request,
}) => {
  // Waits for the next 30 s authenticator step add up.
  test.setTimeout(240_000)
  const shots = process.env.E2E_SHOTS_DIR
  const actor = await createEnrolledThrowawayPlatformAdmin(request, 'sess-e2e-actor')
  const target = await createThrowawayPlatformAdmin(request, 'sess-e2e-target')
  try {
    await uiSignIn(page, actor)
    ageSessionStepUp(actor.email)

    await page.getByRole('tab', { name: 'Platform Admins' }).click()
    const row = page.getByRole('row', { name: new RegExp(target.email) })
    await row.getByRole('button', { name: 'Re-issue enrolment code' }).click()
    await page.getByRole('button', { name: 'Issue new code' }).click()

    // The server refused (403 step_up_required); the console asks for a code.
    const stepUp = page.getByRole('dialog', { name: "Confirm it's you" })
    await expect(stepUp).toBeVisible()
    if (shots) await page.screenshot({ path: `${shots}/step-up-1280.png` })
    await page.setViewportSize({ width: 390, height: 844 })
    await noHorizontalOverflow(page)
    expect(
      (await stepUp.getByLabel('Authentication code').boundingBox())?.height ?? 0,
    ).toBeGreaterThanOrEqual(44)
    expect(
      (await stepUp.getByRole('button', { name: 'Confirm' }).boundingBox())?.height ?? 0,
    ).toBeGreaterThanOrEqual(44)
    if (shots) await page.screenshot({ path: `${shots}/step-up-390.png` })
    await page.setViewportSize({ width: 1280, height: 800 })

    // A wrong code is refused inside the dialog.
    await stepUp.getByLabel('Authentication code').fill('000000')
    await stepUp.getByRole('button', { name: 'Confirm' }).click({ timeout: 10000 })
    await expect(stepUp.getByRole('alert')).toContainText(/invalid/i)

    // Cancelling abandons the action.
    await stepUp.getByRole('button', { name: 'Cancel' }).click()
    await expect(stepUp).toHaveCount(0)
    await expect(page.getByText(/authenticator code to continue/i)).toBeVisible()

    // The confirmation stays open after a cancelled step-up; confirming again retries it,
    // and this time a real code is entered.
    await page.getByRole('button', { name: 'Issue new code' }).click()
    await expect(stepUp).toBeVisible()
    await stepUp.getByLabel('Authentication code').fill(await actor.nextCode())
    await stepUp.getByRole('button', { name: 'Confirm' }).click()
    const code = page.getByRole('dialog').getByTestId('enrolment-code')
    await expect(code).toHaveText(/^[A-Z2-9]{5}(-[A-Z2-9]{5}){3}$/)
    await page.getByRole('button', { name: 'I have passed it on' }).click()

    // Within the window, the next sensitive action does not ask again.
    await row.getByRole('button', { name: 'Re-issue enrolment code' }).click()
    await page.getByRole('button', { name: 'Issue new code' }).click()
    await expect(page.getByRole('dialog').getByTestId('enrolment-code')).toBeVisible()
    await expect(stepUp).toHaveCount(0)
  } finally {
    await deactivateThrowawayPlatformAdmin(request, actor.id)
    await deactivateThrowawayPlatformAdmin(request, target.id)
  }
})

test('My sessions lists own sessions and signs another one out', async ({ page, request }) => {
  test.setTimeout(240_000)
  const shots = process.env.E2E_SHOTS_DIR
  const admin = await createEnrolledThrowawayPlatformAdmin(request, 'sess-e2e-list')
  try {
    await uiSignIn(page, admin)
    const other = await apiSignIn(admin)
    expect(await secondDeviceStatus(other)).toBe(200)

    await page.getByRole('button', { name: 'My sessions' }).click()
    const dialog = page.getByRole('dialog', { name: 'My sessions' })
    // This browser, the second device, and the session the enrolment helper left open.
    await expect(dialog.getByRole('listitem')).toHaveCount(3)
    await expect(dialog.getByText('This session')).toHaveCount(1)
    // No secrets in the list.
    const text = (await dialog.textContent()) ?? ''
    expect(text).not.toMatch(/token|hash/i)
    if (shots) await page.screenshot({ path: `${shots}/my-sessions-1280.png` })

    await page.setViewportSize({ width: 390, height: 844 })
    await noHorizontalOverflow(page)
    for (const button of await dialog.getByRole('button', { name: /^Sign out/ }).all()) {
      expect((await button.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44)
    }
    if (shots) await page.screenshot({ path: `${shots}/my-sessions-390.png` })
    await page.setViewportSize({ width: 1280, height: 800 })

    await dialog
      .getByRole('listitem')
      .filter({ hasText: 'qth-e2e-second-device' })
      .getByRole('button', { name: /^Sign out/ })
      .click()
    await expect(dialog.getByRole('listitem')).toHaveCount(2)
    expect(await secondDeviceStatus(other)).toBe(401)
    // This browser is still signed in.
    await expect(page.getByText(`Signed in as ${admin.email}`)).toBeVisible()

    // Signing out the current session returns to the sign-in form.
    await dialog.getByRole('button', { name: 'Sign out this session' }).click()
    await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible()
  } finally {
    await deactivateThrowawayPlatformAdmin(request, admin.id)
  }
})

test('an idle session returns to sign-in with a clear message', async ({ page, request }) => {
  test.setTimeout(180_000)
  const admin = await createEnrolledThrowawayPlatformAdmin(request, 'sess-e2e-idle')
  try {
    await uiSignIn(page, admin)
    expireSessionIdle(admin.email)
    await page.getByRole('tab', { name: 'Platform Admins' }).click()
    await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible()
    await expect(page.getByRole('status').filter({ hasText: /inactivity/i })).toContainText(
      'signed out after 30 minutes of inactivity',
    )
    // The old cookie is dead for good.
    const me = await page.request.get(`${API_BASE_URL}/platform/auth/me`)
    expect(me.status()).toBe(401)
  } finally {
    await deactivateThrowawayPlatformAdmin(request, admin.id)
  }
})
