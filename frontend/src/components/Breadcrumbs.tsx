import { ChevronRight } from 'lucide-react'
import { Link, useLocation } from 'react-router-dom'

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
    <nav aria-label="Breadcrumb" className="flex items-center gap-1 text-sm">
      <Link to="/" className="text-[var(--muted-foreground)] hover:text-[var(--foreground)]">
        Dashboard
      </Link>
      {crumbs.map((crumb, index) => (
        <span key={crumb.path} className="flex items-center gap-1">
          <ChevronRight className="size-3.5 text-[var(--muted-foreground)]" />
          {index === crumbs.length - 1 ? (
            <span className="font-medium text-[var(--foreground)]">{crumb.label}</span>
          ) : (
            <Link
              to={crumb.path}
              className="text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
            >
              {crumb.label}
            </Link>
          )}
        </span>
      ))}
    </nav>
  )
}
