import { ChevronRight } from 'lucide-react'
import { Link, useLocation } from 'react-router-dom'

import { cn } from '@/lib/utils'

// Maps a static path segment to a readable label. Dynamic segments (ids)
// fall back to a generic "Detail" crumb -- resolving them to the entity's
// actual name would mean a lookup per route, not worth it for a shell-level
// breadcrumb trail.
const SEGMENT_LABELS: Record<string, string> = {
  projects: 'Projects',
  requirements: 'Requirements',
  'test-cases': 'Test Case',
  'test-repository': 'Test Repository',
  'test-runs': 'Test Runs',
  'test-run-cases': 'Execution',
  execution: 'Execution Console',
  defects: 'Defects',
  reporting: 'Reporting',
  admin: 'Administration',
  users: 'Users & Roles',
  roles: 'Roles & Permissions',
  environments: 'Environments',
  'audit-logs': 'Audit Logs',
  settings: 'Settings',
  account: 'My Account',
}

// Bug #6: every route segment must resolve to a friendly label -- a raw
// or truncated path segment slipping through here (e.g. "environmen…")
// was the actual bug report, not a CSS truncation issue downstream.

function isId(segment: string) {
  return /^[0-9a-f-]{8,}$/i.test(segment)
}

export function Breadcrumbs() {
  const location = useLocation()
  const segments = location.pathname.split('/').filter(Boolean)

  if (segments.length === 0) {
    return <span className="text-sm text-[var(--muted-foreground)]">Dashboard</span>
  }

  const crumbs = segments.map((segment, index) => {
    const path = '/' + segments.slice(0, index + 1).join('/')
    const label = isId(segment) ? 'Detail' : (SEGMENT_LABELS[segment] ?? segment)
    return { path, label }
  })

  return (
    <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1 text-sm">
      {/* Below `sm`, only the current page stays visible -- the full trail
          was overflowing into the header's action icons on narrow viewports. */}
      <Link
        to="/"
        className="hidden shrink-0 text-[var(--muted-foreground)] hover:text-[var(--foreground)] sm:inline"
      >
        Dashboard
      </Link>
      {crumbs.map((crumb, index) => {
        const isLast = index === crumbs.length - 1
        return (
          <span
            key={crumb.path}
            className={cn('flex min-w-0 items-center gap-1', !isLast && 'hidden sm:flex')}
          >
            <ChevronRight className="hidden size-3.5 shrink-0 text-[var(--muted-foreground)] sm:block" />
            {isLast ? (
              <span className="truncate font-medium text-[var(--foreground)]">{crumb.label}</span>
            ) : (
              <Link
                to={crumb.path}
                className="truncate text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
              >
                {crumb.label}
              </Link>
            )}
          </span>
        )
      })}
    </nav>
  )
}
