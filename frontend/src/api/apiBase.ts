// Which address the SPA sends API requests to.
//
// In local development the API address is configured as an absolute URL
// (`http://localhost:8000/api/v1`) while the page can be opened at either
// `http://localhost:5173` or `http://127.0.0.1:5173`. Browsers treat the two
// loopback names as different sites, so a page on one calling an API on the
// other is cross-site: SameSite session cookies (the Platform Admin cookie is
// Strict) are dropped and sign-in fails confusingly. So when the configured
// address is a loopback name and the page is on the other loopback name, the
// request goes to the page's own loopback name instead.
//
// Anything else is returned untouched: relative addresses (production serves
// the API from the page's own origin), real hostnames, and a page on any
// non-loopback host.

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1'])
const DEFAULT_DEV_API = 'http://localhost:8000/api/v1'

export function resolveApiBase(
  configured: string | undefined,
  pageHostname: string = window.location.hostname,
): string {
  const base = configured || DEFAULT_DEV_API
  if (base.startsWith('/')) return base

  let url: URL
  try {
    url = new URL(base)
  } catch {
    return base
  }
  if (
    LOOPBACK_HOSTS.has(url.hostname) &&
    LOOPBACK_HOSTS.has(pageHostname) &&
    url.hostname !== pageHostname
  ) {
    url.hostname = pageHostname
    return url.toString().replace(/\/$/, '')
  }
  return base
}
