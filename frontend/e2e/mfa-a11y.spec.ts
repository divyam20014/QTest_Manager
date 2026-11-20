import { expect, test, type Page } from '@playwright/test'

import { axeFindings, formatFindings } from './a11y'
import {
  API_BASE_URL,
  ageSessionStepUp,
  bootstrapTenant,
  createEnrolledThrowawayPlatformAdmin,
  createThrowawayPlatformAdmin,
  deactivateThrowawayPlatformAdmin,
  totpCodeForStep,
  totpStep,
} from './fixtures'

// GAP-22 / issue 35: every sign-in / MFA screen and the Platform Admin dialogs,
// scanned with axe at ALL impact levels, in light and dark, at 390 and 1280
// wide. Also asserts the behaviours axe cannot see: the QR image has a text
// alternative, the provisioning URI behind the QR is a well-formed otpauth URI
// whose secret is the manual-entry key, code inputs are labelled and typed for
// one-time-code entry, errors are announced, and focus moves/traps/returns
// correctly in dialogs. Throwaway tenant + throwaway Platform Admins only
// (deactivated at the end); the shared dev admin is never signed in here.

const COMBOS = [
  { width: 390, height: 844, theme: 'light' },
  { width: 390, height: 844, theme: 'dark' },
  { width: 1280, height: 800, theme: 'light' },
  { width: 1280, height: 800, theme: 'dark' },
] as const

async function scanAll(page: Page, label: string, problems: string[]) {
  const original = page.viewportSize() ?? { width: 1280, height: 800 }
  for (const c of COMBOS) {
    await page.setViewportSize({ width: c.width, height: c.height })
    await page.evaluate((t) => {
      document.documentElement.dataset.theme = t
    }, c.theme)
    await page.waitForTimeout(250)
    const findings = await axeFindings(page)
    problems.push(...formatFindings(`${label} @${c.width} ${c.theme}`, findings))
  }
  await page.setViewportSize(original)
  await page.evaluate(() => {
    document.documentElement.dataset.theme = 'light'
  })
}

async function focusIsIn(page: Page, selector: string): Promise<boolean> {
  return page.evaluate((sel) => {
    const root = document.querySelector(sel)
    return !!root && !!document.activeElement && root.contains(document.activeElement)
  }, selector)
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    try {
      localStorage.setItem('qtesthub:theme', 'light')
    } catch {
      /* storage unavailable */
    }
  })
})

test('tenant sign-in steps (email, password, MFA code) pass axe at all impacts', async ({
  page,
  request,
}) => {
  test.setTimeout(300_000)
  const tenant = await bootstrapTenant(request, 'MfaA11y')
  const problems: string[] = []
  await page.goto('/login')
  await page.waitForSelector('text=Sign in to your organization')
  await scanAll(page, 'tenant-email', problems)
  await page.fill('#email', tenant.adminEmail)
  await page.click('button[type="submit"]:has-text("Continue")')
  await page.waitForSelector('#password')
  await scanAll(page, 'tenant-password', problems)
  await page.fill('#password', tenant.adminPassword)
  await page.click('button[type="submit"]:has-text("Sign in")')
  await page.waitForSelector('text=Enter your verification code')
  // Code input: labelled, numeric keypad, one-time-code autofill, no spellcheck.
  const code = page.getByLabel('Verification code')
  await expect(code).toHaveAttribute('autocomplete', 'one-time-code')
  await expect(code).toHaveAttribute('inputmode', 'numeric')
  await scanAll(page, 'tenant-mfa', problems)
  // A wrong code is announced (role=alert) rather than only coloured.
  await code.fill('000000')
  await page.click('button:has-text("Verify")')
  await expect(page.getByRole('alert')).toBeVisible()
  expect(problems, problems.join('\n')).toEqual([])
})

test('Platform Admin sign-in, reset-code step and enrolment (QR, recovery codes) pass axe and announce errors', async ({
  page,
  request,
}) => {
  test.setTimeout(300_000)
  const admin = await createThrowawayPlatformAdmin(request, 'mfa-a11y-enrol')
  const problems: string[] = []
  try {
    await page.goto('/platform-admin')
    await expect(page.getByRole('heading', { name: 'Platform Administration' })).toBeVisible()
    await scanAll(page, 'platform-signin', problems)

    await page.getByRole('button', { name: 'Have a reset code?' }).click()
    await expect(page.getByRole('heading', { name: 'Reset your password' })).toBeVisible()
    await scanAll(page, 'platform-reset-code', problems)
    await page.getByRole('button', { name: /back/i }).first().click()

    await page.getByLabel('Email').fill(admin.email)
    await page.getByLabel('Password').fill(admin.password)
    await page.getByRole('button', { name: 'Sign in' }).click()
    await expect(page.getByRole('heading', { name: 'Enter your enrolment code' })).toBeVisible()
    // Step change moves focus into the new step (not left on a removed node / body).
    await expect.poll(() => focusIsIn(page, 'main, form')).toBe(true)
    await scanAll(page, 'platform-enrol-code', problems)

    await page.getByLabel('Enrolment code').fill('ZZZZZ-ZZZZZ-ZZZZZ-ZZZZZ')
    const wrongBtn = page.getByRole('button', { name: 'Continue' })
    await wrongBtn.click()
    await expect(page.getByRole('alert')).toContainText('Invalid or expired enrolment code')

    // Capture the provisioning response the QR is rendered from.
    const startResponse = page.waitForResponse((r) => r.url().includes('/mfa/enroll/start'))
    await page.getByLabel('Enrolment code').fill(admin.enrolmentCode)
    await page.getByRole('button', { name: 'Continue' }).click()
    const started = (await (await startResponse).json()).data as { secret: string; otpauth_uri: string }
    await expect(page.getByRole('heading', { name: 'Set up two-step verification' })).toBeVisible()

    // QR: exposed as an image with a text alternative, plus a manual-entry key.
    await expect(page.getByRole('img', { name: 'QR code for your authenticator app' })).toBeVisible()
    const manual = page.getByLabel('Setup key (manual entry)')
    const shownSecret = (await manual.inputValue()).replace(/\s/g, '')
    // The URI the QR encodes: issuer, account, base32 secret, 30 s, 6 digits, SHA1.
    const uri = new URL(started.otpauth_uri)
    expect(uri.protocol).toBe('otpauth:')
    expect(uri.hostname).toBe('totp')
    const label = decodeURIComponent(uri.pathname.slice(1))
    const issuer = uri.searchParams.get('issuer') ?? ''
    expect(issuer.length).toBeGreaterThan(0)
    expect(label).toBe(`${issuer}:${admin.email}`)
    const secret = uri.searchParams.get('secret') ?? ''
    expect(secret).toMatch(/^[A-Z2-7]{16,}$/)
    expect(secret).toBe(shownSecret)
    expect(uri.searchParams.get('period')).toBe('30')
    expect(uri.searchParams.get('digits')).toBe('6')
    expect(uri.searchParams.get('algorithm')).toBe('SHA1')
    // The code input is labelled and typed for one-time-code entry.
    const codeInput = page.getByLabel('Authentication code')
    await expect(codeInput).toHaveAttribute('autocomplete', 'one-time-code')
    await expect(codeInput).toHaveAttribute('inputmode', 'numeric')
    await scanAll(page, 'platform-enrol-qr', problems)

    await codeInput.fill('000000')
    await page.getByRole('button', { name: 'Verify and enable' }).click()
    await expect(page.getByRole('alert')).toContainText('Invalid verification code')

    await codeInput.fill(totpCodeForStep(secret, totpStep()))
    await page.getByRole('button', { name: 'Verify and enable' }).click()
    await expect(page.getByRole('heading', { name: 'Save your recovery codes' })).toBeVisible()
    await expect.poll(() => focusIsIn(page, 'main, form')).toBe(true)
    await scanAll(page, 'platform-recovery-codes', problems)
  } finally {
    await deactivateThrowawayPlatformAdmin(request, admin.id)
  }
  expect(problems, problems.join('\n')).toEqual([])
})

test('Platform Admin verify step, console dialogs and Audit tab pass axe; dialogs trap focus, close on Escape and return focus', async ({
  page,
  request,
}) => {
  test.setTimeout(420_000)
  const actor = await createEnrolledThrowawayPlatformAdmin(request, 'mfa-a11y-actor')
  const target = await createThrowawayPlatformAdmin(request, 'mfa-a11y-target')
  const problems: string[] = []
  try {
    await page.goto('/platform-admin')
    await page.getByLabel('Email').fill(actor.email)
    await page.getByLabel('Password').fill(actor.password)
    await page.getByRole('button', { name: 'Sign in' }).click()
    await expect(page.getByRole('heading', { name: 'Two-step verification' })).toBeVisible()
    const code = page.getByLabel('Authentication code')
    await expect(code).toHaveAttribute('autocomplete', 'one-time-code')
    await scanAll(page, 'platform-verify', problems)
    await page.getByRole('button', { name: 'Use a recovery code instead' }).click()
    await scanAll(page, 'platform-verify-recovery', problems)
    await page.getByLabel('Recovery code').fill(actor.recoveryCodes[0])
    await page.getByRole('button', { name: 'Verify' }).click()
    await expect(page.getByText(`Signed in as ${actor.email}`)).toBeVisible()

    // Dialog behaviour + axe: open, focus inside, Tab stays inside, Escape closes, focus returns.
    async function checkDialog(openerName: string, dialogName: string | RegExp, label: string) {
      const opener = page.getByRole('button', { name: openerName })
      await opener.click()
      const dialog = page.getByRole('dialog', { name: dialogName })
      await expect(dialog).toBeVisible()
      await expect.poll(() => focusIsIn(page, '[role="dialog"]')).toBe(true)
      for (let i = 0; i < 12; i++) await page.keyboard.press('Tab')
      expect(await focusIsIn(page, '[role="dialog"]'), `${label}: Tab escaped the dialog`).toBe(true)
      for (let i = 0; i < 12; i++) await page.keyboard.press('Shift+Tab')
      expect(await focusIsIn(page, '[role="dialog"]'), `${label}: Shift+Tab escaped the dialog`).toBe(true)
      await scanAll(page, label, problems)
      await page.keyboard.press('Escape')
      await expect(dialog).toHaveCount(0)
      await expect(opener, `${label}: focus not returned to opener`).toBeFocused()
    }
    await checkDialog('My sessions', 'My sessions', 'platform-my-sessions')
    await checkDialog('Change password', 'Change password', 'platform-change-password')

    // Audit tab.
    await page.getByRole('tab', { name: 'Audit' }).click()
    await expect(page.getByRole('tabpanel')).toBeVisible()
    await page.waitForLoadState('networkidle')
    await scanAll(page, 'platform-audit-tab', problems)

    // Enrolment-code dialog (shown once) from the Platform Admins tab.
    await page.getByRole('tab', { name: 'Platform Admins' }).click()
    const row = page.getByRole('row', { name: new RegExp(target.email) })
    await row.getByRole('button', { name: 'Re-issue enrolment code' }).click()
    await page.getByRole('button', { name: 'Issue new code' }).click()
    const issued = page.getByRole('dialog', { name: /Enrolment code for/ })
    await expect(issued).toBeVisible()
    await expect.poll(() => focusIsIn(page, '[role="dialog"]')).toBe(true)
    await scanAll(page, 'platform-enrolment-code-dialog', problems)
    await issued.getByRole('button', { name: 'I have passed it on' }).click()
    await expect(issued).toHaveCount(0)

    // Step-up dialog: age the step-up, then a sensitive action prompts for a code.
    ageSessionStepUp(actor.email)
    await row.getByRole('button', { name: 'Re-issue enrolment code' }).click()
    await page.getByRole('button', { name: 'Issue new code' }).click()
    const stepUp = page.getByRole('dialog', { name: "Confirm it's you" })
    await expect(stepUp).toBeVisible()
    // (The issue-code confirmation may still be closing underneath: look at THIS dialog.)
    await expect
      .poll(() => focusIsIn(page, `[role="dialog"][aria-label="Confirm it's you"]`))
      .toBe(true)
    await expect(stepUp.getByLabel('Authentication code')).toHaveAttribute(
      'autocomplete',
      'one-time-code',
    )
    await scanAll(page, 'platform-step-up', problems)
    await stepUp.getByLabel('Authentication code').fill('000000')
    await stepUp.getByRole('button', { name: 'Confirm' }).click()
    await expect(stepUp.getByRole('alert')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(stepUp).toHaveCount(0)
  } finally {
    await deactivateThrowawayPlatformAdmin(request, actor.id)
    await deactivateThrowawayPlatformAdmin(request, target.id)
  }
  expect(problems, problems.join('\n')).toEqual([])
  void API_BASE_URL
})
