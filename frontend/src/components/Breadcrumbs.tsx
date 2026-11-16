import { ChevronRight } from 'lucide-react'
import { Link, useLocation } from 'react-router-dom'

import { cn } from '@/lib/utils'

// Maps a static path segment to a readable label. Dynamic segments (ids)
// are labelled by the kind of record the preceding segment names
// (ID_LABELS) -- resolving them to the entity's actual name would mean a
// lookup per route, not worth it for a shell-level breadcrumb trail.
const SEGMENT_LABELS: Record<string, string> = {
  projects: 'Projects',
  requirements: 'Requirements',
  'test-cases': 'Test Cases',
  'test-repository': 'Test Repository',
  'test-runs': 'Test Runs',
  'test-run-cases': 'Execution Console',
  execution: 'Execution Console',
  defects: 'Defects',
  reporting: 'Reporting',
  'traceability-matrix': 'Traceability Matrix',
  admin: 'Administration',
  users: 'Users & Roles',
  roles: 'Roles & Permissions',
  environments: 'Environments',
  'audit-logs': 'Audit Logs',
  settings: 'Settings',
  account: 'My Account',
}

const ID_LABELS: Record<string, string> = {
  projects: 'Project',
  requirements: 'Requirement',
  'test-cases': 'Test Case',
  'test-runs': 'Test Run',
  'test-run-cases': 'Test Case',
  defects: 'Defect',
}

// Top-level segments that only exist as a prefix for a detail route
// (/test-cases/:id) -- there is no list page at that path, so the crumb is
// plain text rather than a link to a 404.
const NO_LIST_PAGE = new Set(['test-cases', 'requirements', 'test-run-cases'])

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
    const label = isId(segment) ? (ID_LABELS[segments[index - 1]] ?? 'Detail') : (SEGMENT_LABELS[segment] ?? segment)
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
            {isLast || (index === 0 && NO_LIST_PAGE.has(segments[0])) ? (
              <span
                className={cn(
                  'truncate',
                  isLast ? 'font-medium text-[var(--foreground)]' : 'text-[var(--muted-foreground)]',
                )}
              >
                {crumb.label}
              </span>
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
