import { useQuery } from '@tanstack/react-query'
import { ChevronRight } from 'lucide-react'
import { Link, useLocation } from 'react-router-dom'

import { listDashboards } from '@/api/dashboards'
import { listDocs } from '@/api/docs'
import { getProject } from '@/api/projects'
import { useAuth } from '@/lib/auth'
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
  'access-rules': 'Access Rules',
  'audit-logs': 'Audit Logs',
  settings: 'Settings',
  account: 'My Account',
  brd: 'Documentation',
  dashboards: 'Manage',
  details: 'Details',
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
  const { user } = useAuth()
  // /brd/:docId -- the document's own title comes from the (cached) document
  // list the viewer already fetches, so no second request in practice.
  const onDoc = segments[0] === 'brd' && segments.length > 1
  const docList = useQuery({
    queryKey: ['brd-docs', user?.user_id],
    queryFn: listDocs,
    enabled: onDoc && !!user,
    staleTime: 60_000,
  })

  // /dashboards/:id -- "Dashboard > <name>" (same cached list the view switcher reads).
  const onDash = segments[0] === 'dashboards' && segments.length > 1
  const dashList = useQuery({
    queryKey: ['dashboards', 'list', user?.user_id],
    queryFn: listDashboards,
    enabled: onDash && !!user,
    staleTime: 30_000,
  })

  // /projects/:id/... -- "Projects > <project name> > Dashboard|Details" (shares the project page's cache).
  const projectId = segments[0] === 'projects' && segments[1] && isId(segments[1]) ? segments[1] : undefined
  const projectQuery = useQuery({
    queryKey: ['projects', projectId],
    queryFn: () => getProject(projectId!),
    enabled: !!projectId && !!user,
    staleTime: 30_000,
  })

  if (segments.length === 0) {
    return <span className="text-sm text-[var(--muted-foreground)]">Dashboard</span>
  }

  const crumbs = segments
    .map((segment, index) => {
      const path = '/' + segments.slice(0, index + 1).join('/')
      const docTitle =
        segments[0] === 'brd' && index === 1
          ? docList.data?.documents.find((d) => d.slug === segment)?.title
          : undefined
      const dashName =
        segments[0] === 'dashboards' && index === 1 ? dashList.data?.find((d) => d.id === segment)?.name : undefined
      const label =
        (projectId && index === 1 ? projectQuery.data?.name : undefined) ??
        docTitle ??
        dashName ??
        (isId(segment) ? (ID_LABELS[segments[index - 1]] ?? 'Detail') : (SEGMENT_LABELS[segment] ?? segment))
      return { path, label }
    })
    .filter((_, index) => !(onDash && index === 0))
  if (projectId && segments.length === 2) crumbs.push({ path: location.pathname + '#dashboard', label: 'Dashboard' })

  return (
    <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1 text-sm">
      {/* Below `sm`, only the current page stays visible -- the full trail
          was overflowing into the header's action icons on narrow viewports. */}
      <Link to="/" className="hidden shrink-0 text-[var(--muted-foreground)] hover:text-[var(--foreground)] sm:inline">
        Dashboard
      </Link>
      {crumbs.map((crumb, index) => {
        const isLast = index === crumbs.length - 1
        return (
          <span
            key={crumb.path}
            // When the trail is too wide for the header (the right-hand controls take most of
            // it), the parent crumbs give way first (a much higher shrink weight) so the
            // current page keeps its full title; the current page only truncates once the
            // parents are already gone.
            className={cn('flex min-w-0 items-center gap-1', !isLast && 'hidden shrink-[100] sm:flex')}
          >
            <ChevronRight className="hidden size-3.5 shrink-0 text-[var(--muted-foreground)] sm:block" />
            {isLast || (index === 0 && NO_LIST_PAGE.has(segments[0])) ? (
              <span
                title={crumb.label}
                aria-current={isLast ? 'page' : undefined}
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
                title={crumb.label}
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
