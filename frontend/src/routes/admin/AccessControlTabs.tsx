import { NavLink } from 'react-router-dom'

import { useAuth } from '@/lib/auth'
import { canAccessPath } from '@/lib/routeAccess'
import { cn } from '@/lib/utils'

// ADR-108 follow-up: Roles & Permissions and Access rules share one sidebar item
// ("Access control"); this strip (same pattern as reporting/ReportTabs.tsx)
// switches between the two pages. Each tab shows only if the user can reach its
// route, and a lone tab is not worth a strip.
const TABS = [
  { label: 'Roles & Permissions', to: '/admin/roles' },
  { label: 'Access rules', to: '/admin/access-rules' },
]

export function AccessControlTabs() {
  const { user } = useAuth()
  const tabs = TABS.filter((t) => canAccessPath(user, t.to))
  if (tabs.length < 2) return null
  return (
    <nav
      aria-label="Access control sections"
      className="-mb-2 max-w-full overflow-x-auto border-b border-[var(--border)]"
    >
      <ul className="flex min-w-max gap-1">
        {tabs.map((t) => (
          <li key={t.to}>
            <NavLink
              to={t.to}
              end
              className={({ isActive }) =>
                cn(
                  'inline-flex min-h-11 items-center border-b-2 px-3 text-sm font-medium whitespace-nowrap',
                  isActive
                    ? 'border-[var(--primary)] text-[var(--foreground)]'
                    : 'border-transparent text-[var(--muted-foreground)] hover:text-[var(--foreground)]',
                )
              }
            >
              {t.label}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  )
}
