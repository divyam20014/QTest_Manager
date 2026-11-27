import type { BrowserContext } from '@playwright/test'

import { API_BASE_URL, FIXTURE_USER_AGENT, getPlatformSessionToken } from './fixtures'

// ADR-114: the full documentation is read inside the platform console. The
// session is the shared dev platform admin's, obtained through the real
// password + TOTP flow by `getPlatformSessionToken` and handed to the browser
// as the HttpOnly cookie the console would have set. A platform session is
// bound to the User-Agent it was issued to, so a spec using this must also call
// `test.use({ userAgent: PLATFORM_DOCS_USER_AGENT })`.
export const PLATFORM_DOCS_USER_AGENT = FIXTURE_USER_AGENT

export async function signInPlatformBrowser(context: BrowserContext): Promise<void> {
  const token = await getPlatformSessionToken()
  const api = new URL(API_BASE_URL)
  await context.addCookies([
    {
      name: 'qth_platform_session',
      value: token,
      domain: api.hostname,
      path: '/api/v1/platform',
      httpOnly: true,
      sameSite: 'Strict',
    },
  ])
}
