import { isAdmin, isManagerOrAbove, type MeResponse } from '@/api/auth'

/**
 * The single definition of which signed-in screens are restricted, and to
 * whom. The sidebar, the mobile "More" sheet, the command palette and the
 * route gate all read it, so what is hidden from the menu and what is blocked
 * by URL can never drift apart.
 *
 * It only decides what the UI shows. The API enforces every permission itself
 * and stays authoritative; a 403 from it is shown the same way (see
 * `NoAccess`).
 */
export type AccessLevel = 'admin' | 'manager-or-above'

/** Path prefixes that need more than a signed-in session. A path matches an
 * entry when it equals it or sits beneath it (`/admin/users/…`). Anything not
 * listed is open to every signed-in user (the API still applies its own
 * per-resource checks). */
export const ROUTE_ACCESS: ReadonlyArray<{ path: string; level: AccessLevel }> = [
  { path: '/admin/users', level: 'admin' },
  { path: '/admin/roles', level: 'admin' },
  { path: '/admin/audit-logs', level: 'admin' },
  // Environments is also gated at the API by `environment.manage`, which
  // Managers hold, so it is open to manager-or-above rather than admin only.
  { path: '/admin/environments', level: 'manager-or-above' },
  { path: '/settings', level: 'admin' },
  // `/admin` redirects to `/admin/users`.
  { path: '/admin', level: 'admin' },
]

export function hasAccessLevel(user: MeResponse | null, level: AccessLevel): boolean {
  return level === 'admin' ? isAdmin(user) : isManagerOrAbove(user)
}

/** The level a path requires, or `null` when any signed-in user may open it. */
export function accessLevelForPath(pathname: string): AccessLevel | null {
  const clean = pathname.replace(/\/+$/, '') || '/'
  for (const entry of ROUTE_ACCESS) {
    if (clean === entry.path || clean.startsWith(`${entry.path}/`)) return entry.level
  }
  return null
}

/** Whether the UI should offer / open `pathname` for this user. */
export function canAccessPath(user: MeResponse | null, pathname: string): boolean {
  const level = accessLevelForPath(pathname)
  return level === null || hasAccessLevel(user, level)
}
