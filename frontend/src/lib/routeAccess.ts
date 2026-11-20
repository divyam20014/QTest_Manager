import { hasPermission, isAdmin, isManagerOrAbove, type MeResponse } from '@/api/auth'

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

/** What a restricted path needs: a coarse role level, or one specific permission
 * (for screens the API gates by a permission that roles hold unevenly, so the UI
 * follows the permission rather than guessing from the role name). */
export type AccessRule = { level: AccessLevel } | { permission: string }

/** Path prefixes that need more than a signed-in session. A path matches an
 * entry when it equals it or sits beneath it (`/admin/users/…`). Anything not
 * listed is open to every signed-in user (the API still applies its own
 * per-resource checks). */
export const ROUTE_ACCESS: ReadonlyArray<{ path: string } & AccessRule> = [
  { path: '/admin/users', level: 'admin' },
  { path: '/admin/roles', level: 'admin' },
  { path: '/admin/audit-logs', level: 'admin' },
  // Environments is also gated at the API by `environment.manage`, which
  // Managers hold, so it is open to manager-or-above rather than admin only.
  { path: '/admin/environments', level: 'manager-or-above' },
  // Managed by `access_rule.manage` (Admin only today; the API is authoritative).
  { path: '/admin/access-rules', permission: 'access_rule.manage' },
  { path: '/settings', level: 'admin' },
  // `/admin` redirects to `/admin/users`.
  { path: '/admin', level: 'admin' },
  // The compliance report data endpoints require `report.compliance_export`
  // (Admin and Manager hold it; Tester does not, and a custom role may or may not).
  { path: '/reporting/print', permission: 'report.compliance_export' },
]

export function hasAccessLevel(user: MeResponse | null, level: AccessLevel): boolean {
  return level === 'admin' ? isAdmin(user) : isManagerOrAbove(user)
}

/** The rule a path is restricted by, or `null` when any signed-in user may open it. */
export function accessRuleForPath(pathname: string): AccessRule | null {
  const clean = pathname.replace(/\/+$/, '') || '/'
  for (const entry of ROUTE_ACCESS) {
    if (clean === entry.path || clean.startsWith(`${entry.path}/`)) {
      return 'level' in entry ? { level: entry.level } : { permission: entry.permission }
    }
  }
  return null
}

/** Whether the UI should offer / open `pathname` for this user. */
export function canAccessPath(user: MeResponse | null, pathname: string): boolean {
  // ADR-093: a tenant can hide Reports from Testers; the API also returns 403.
  if (user?.reports_hidden && (pathname === '/reporting' || pathname.startsWith('/reporting/'))) {
    return false
  }
  const rule = accessRuleForPath(pathname)
  if (rule === null) return true
  return 'level' in rule ? hasAccessLevel(user, rule.level) : hasPermission(user, rule.permission)
}
