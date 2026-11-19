import { createHmac } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { request as pwRequest } from '@playwright/test'
import type { APIRequestContext, Page } from '@playwright/test'

export const API_BASE_URL = process.env.E2E_API_BASE_URL ?? 'http://localhost:8000/api/v1'

// Platform-admin provisioning is deliberately out-of-band (not exposed over
// HTTP, see backend/scripts/seed_platform_admin.py) -- before running this
// suite, seed one with a KNOWN dev/test TOTP secret (ADR-074: Platform Admin
// sign-in is password + authenticator code; --totp-secret is refused in
// production):
//   docker compose exec api python -m scripts.seed_platform_admin \
//     --email owner@qtesthub.local --password Sup3rSecret1Pass \
//     --totp-secret JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP
export const PLATFORM_ADMIN_EMAIL = process.env.E2E_PLATFORM_ADMIN_EMAIL ?? 'owner@qtesthub.local'
export const PLATFORM_ADMIN_PASSWORD = process.env.E2E_PLATFORM_ADMIN_PASSWORD ?? 'Sup3rSecret1Pass'
export const PLATFORM_ADMIN_TOTP_SECRET =
  process.env.E2E_PLATFORM_ADMIN_TOTP_SECRET ?? 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP'

const PLATFORM_COOKIE = 'qth_platform_session'
const PERIOD = 30

// --- RFC 6238 TOTP (SHA-1, 6 digits, 30 s) ---------------------------------

function base32Decode(input: string): Buffer {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  let bits = ''
  for (const ch of input.replace(/[\s=]/g, '').toUpperCase()) {
    const idx = alphabet.indexOf(ch)
    if (idx < 0) throw new Error('Invalid base32 TOTP secret')
    bits += idx.toString(2).padStart(5, '0')
  }
  const bytes: number[] = []
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2))
  return Buffer.from(bytes)
}

export function totpStep(atMs: number = Date.now()): number {
  return Math.floor(atMs / 1000 / PERIOD)
}

export function totpCodeForStep(secret: string, step: number): string {
  const counter = Buffer.alloc(8)
  counter.writeBigUInt64BE(BigInt(step))
  const digest = createHmac('sha1', base32Decode(secret)).update(counter).digest()
  const offset = digest[digest.length - 1] & 0x0f
  const binary = digest.readUInt32BE(offset) & 0x7fffffff
  return String(binary % 1_000_000).padStart(6, '0')
}

// The server rejects a time step that was already used (replay protection),
// so every sign-in with the shared dev admin must use a strictly newer step
// than the last one any spec used. The last used step is shared between
// Playwright worker processes through a small file in the OS temp dir.
const STATE_FILE = join(tmpdir(), 'qth-e2e-platform-state.json')

interface SharedState {
  lastStep?: number
  token?: string
}

function readState(): SharedState {
  try {
    return existsSync(STATE_FILE)
      ? (JSON.parse(readFileSync(STATE_FILE, 'utf8')) as SharedState)
      : {}
  } catch {
    return {}
  }
}

function writeState(patch: SharedState): void {
  try {
    writeFileSync(STATE_FILE, JSON.stringify({ ...readState(), ...patch }))
  } catch {
    // best effort -- a missing cache only costs an extra sign-in
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** A TOTP code for the shared dev admin that the server will accept now:
 * the newest step inside the +-1 tolerance window that is strictly newer than
 * any step already used. Waits for the next 30 s boundary when none is left. */
export async function freshPlatformTotpCode(
  secret: string = PLATFORM_ADMIN_TOTP_SECRET,
): Promise<string> {
  for (;;) {
    const state = readState()
    const now = totpStep()
    const lastStep = state.lastStep ?? 0
    const candidate = Math.max(now, lastStep + 1)
    if (candidate <= now + 1) {
      writeState({ lastStep: candidate })
      return totpCodeForStep(secret, candidate)
    }
    const msToNextStep = (now + 1) * PERIOD * 1000 - Date.now() + 250
    await sleep(Math.max(250, msToNextStep))
  }
}

function cookieHeader(token: string): Record<string, string> {
  return { Cookie: `${PLATFORM_COOKIE}=${token}` }
}

function tokenFrom(setCookie: string | undefined): string | null {
  if (!setCookie) return null
  const match = setCookie.match(new RegExp(`${PLATFORM_COOKIE}=([^;,\\s]+)`))
  return match ? match[1] : null
}

/** Signs in as the shared dev platform admin through the REAL password +
 * TOTP flow and returns the fully authenticated session token. Reuses a
 * cached live session when there is one (the server enforces a 30 min idle
 * timeout, so a cached token is re-validated before use). */
export async function getPlatformSessionToken(forceFresh = false): Promise<string> {
  const api = await pwRequest.newContext()
  try {
    const cached = forceFresh ? undefined : readState().token
    if (cached) {
      const me = await api.get(`${API_BASE_URL}/platform/auth/me`, {
        headers: cookieHeader(cached),
      })
      if (me.ok() && (await me.json()).data?.stage === 'mfa_verified') return cached
    }

    const login = await api.post(`${API_BASE_URL}/platform/auth/login`, {
      data: { email: PLATFORM_ADMIN_EMAIL, password: PLATFORM_ADMIN_PASSWORD },
    })
    const pre = tokenFrom(login.headers()['set-cookie'])
    if (!login.ok() || !pre) {
      throw new Error(
        `Platform admin sign-in failed (${login.status()}): ${await login.text()}. ` +
          'Has the platform admin been seeded? See the comment at the top of e2e/fixtures.ts.',
      )
    }
    const verify = await api.post(`${API_BASE_URL}/platform/auth/mfa/verify`, {
      data: { code: await freshPlatformTotpCode() },
      headers: cookieHeader(pre),
    })
    const full = tokenFrom(verify.headers()['set-cookie'])
    if (!verify.ok() || !full) {
      throw new Error(
        `Platform admin MFA failed (${verify.status()}): ${await verify.text()}. ` +
          'Was the admin seeded with --totp-secret matching E2E_PLATFORM_ADMIN_TOTP_SECRET?',
      )
    }
    writeState({ token: full })
    return full
  } finally {
    await api.dispose()
  }
}

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
  const data = {
    tenant_name: `${namePrefix} ${unique}`,
    admin_name: 'Admin E2E',
    admin_email: adminEmail,
    admin_password: adminPassword,
  }

  let response = await request.post(`${API_BASE_URL}/platform/tenants`, {
    headers: cookieHeader(await getPlatformSessionToken()),
    data,
  })
  if (response.status() === 401) {
    // Session expired / revoked mid-run: sign in again once.
    response = await request.post(`${API_BASE_URL}/platform/tenants`, {
      headers: cookieHeader(await getPlatformSessionToken(true)),
      data,
    })
  }
  if (!response.ok()) {
    throw new Error(
      `Tenant bootstrap failed (${response.status()}): ${await response.text()}. ` +
        'Has the platform admin been seeded? See the comment at the top of e2e/fixtures.ts.',
    )
  }
  const body = await response.json()
  return { tenantId: body.data.tenant.id, adminEmail, adminPassword }
}

/** ADR-067: tenant-less login -- email first (resolved server-side via
 * POST /auth/identify; each e2e-seeded email is unique to exactly one
 * tenant, so this always auto-advances straight to the password step,
 * never the multi-tenant org picker), then password, then MFA. `tenantId`
 * is accepted for signature compatibility with existing call sites but is
 * no longer typed anywhere in the UI. */
export async function loginViaUi(
  page: Page,
  _tenantId: string,
  email: string,
  password: string,
): Promise<void> {
  await page.goto('/login')
  await page.waitForSelector('text=Sign in to your organization')
  await page.fill('#email', email)
  await page.click('button[type="submit"]:has-text("Continue")')
  await page.waitForSelector('#password')
  await page.fill('#password', password)
  // Tier 4 / ADR-054: this step also renders a separate "Sign in with SSO"
  // button -- scoped to the submit button specifically so this doesn't hit
  // a strict-mode ambiguity between the two.
  await page.click('button[type="submit"]:has-text("Sign in")')
  await page.waitForSelector('text=Enter your verification code')
  const bodyText = await page.textContent('body')
  const match = bodyText?.match(/Dev mode code:\s*(\d{6})/)
  if (!match) throw new Error('Dev-mode MFA code not found on verification screen')
  await page.fill('#code', match[1])
  await page.click('button:has-text("Verify")')
  await page.waitForSelector('h1:has-text("Dashboard")')
}
