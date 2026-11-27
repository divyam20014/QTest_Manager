// ADR-134: where the browser tests are allowed to point. The tests create tenants and
// platform admins, sign in with test passwords and edit database rows, so they must never
// reach the development stack (the app on 5173, its API on 8000, the database `qtesthub`).
// scripts/run_e2e.py builds a throwaway stack and sets these; `npm run test:e2e` runs it.

export const WEB_URL = process.env.E2E_WEB_URL ?? 'http://localhost:5175'
export const API_BASE_URL = process.env.E2E_API_BASE_URL ?? 'http://localhost:8100/api/v1'
export const DB_NAME = process.env.E2E_DB_NAME ?? 'qtesthub_e2e'

/** The same web app under the other loopback name (a different site to a browser). */
export const LOOPBACK_WEB_URL = WEB_URL.replace('//localhost', '//127.0.0.1')

const DEV_STACK_PORTS = ['5173', '8000']
const LOOPBACK_HOSTS = ['localhost', '127.0.0.1']
const THROWAWAY_DB = /^qtesthub_(e2e|audit)[a-z0-9_]*$/

export function unsafeTargetReasons(
  web: string,
  api: string,
  database: string,
  isolatedStack: string | undefined,
): string[] {
  const reasons: string[] = []
  if (isolatedStack !== '1') {
    reasons.push('the isolated stack was not started (E2E_ISOLATED_STACK is not set)')
  }
  for (const [name, value] of [
    ['E2E_WEB_URL', web],
    ['E2E_API_BASE_URL', api],
  ]) {
    let url: URL
    try {
      url = new URL(value)
    } catch {
      reasons.push(`${name} is not a URL`)
      continue
    }
    if (!LOOPBACK_HOSTS.includes(url.hostname)) reasons.push(`${name} is not on this computer`)
    // An empty port means 80 or 443, where a deployed app answers, never a test server.
    if (!url.port) reasons.push(`${name} has no port, so it is not a test server`)
    else if (DEV_STACK_PORTS.includes(url.port)) {
      reasons.push(`${name} uses port ${url.port}, which belongs to the real app`)
    }
  }
  if (!THROWAWAY_DB.test(database)) reasons.push(`E2E_DB_NAME "${database}" is not a throwaway test database`)
  return reasons
}

export function assertIsolatedTarget(): void {
  const reasons = unsafeTargetReasons(WEB_URL, API_BASE_URL, DB_NAME, process.env.E2E_ISOLATED_STACK)
  if (reasons.length === 0) return
  throw new Error(
    [
      'Browser tests stopped: they could reach your real app or database.',
      ...reasons.map((r) => `  - ${r}`),
      'Run them with:  npm run test:e2e -- <spec files or Playwright options>',
      'which starts a throwaway database and servers and removes them afterwards.',
    ].join('\n'),
  )
}
