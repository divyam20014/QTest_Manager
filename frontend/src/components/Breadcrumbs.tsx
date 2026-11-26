import { useQuery } from '@tanstack/react-query'
import { ChevronRight } from 'lucide-react'
import { Link, useLocation } from 'react-router-dom'

import { listDashboards } from '@/api/dashboards'
import { getProject } from '@/api/projects'
import { buildCrumbs, isIdSegment, scopedProjectId } from '@/lib/breadcrumbs'
import { useAuth } from '@/lib/auth'
import { cn } from '@/lib/utils'

const SHORT_CRUMB = 12
const LINK_CLASS = 'truncate text-[var(--muted-foreground)] hover:text-[var(--foreground)]'

export function Breadcrumbs() {
  const location = useLocation()
  const segments = location.pathname.split('/').filter(Boolean)
  const { user } = useAuth()
  // /dashboards/:id -- "Dashboard > <name>" (same cached list the view switcher reads).
  const onDash = segments[0] === 'dashboards' && segments.length > 1
  const dashList = useQuery({
    queryKey: ['dashboards', 'list', user?.user_id],
    queryFn: listDashboards,
    enabled: onDash && !!user,
    staleTime: 30_000,
  })

  // /projects/:id/... -- "Projects > <project name> > ..." (shares the project page's cache).
  const projectId =
    segments[0] === 'projects' && segments[1] && isIdSegment(segments[1])
      ? segments[1]
      : scopedProjectId(location.pathname, location.search)
  const projectQuery = useQuery({
    queryKey: ['projects', projectId],
    queryFn: () => getProject(projectId!),
    enabled: !!projectId && !!user,
    staleTime: 30_000,
  })

  const crumbs = buildCrumbs(location.pathname, {
    project: projectQuery.data?.name,
    search: location.search,
    dashboardName: dashList.data?.find((d) => d.id === segments[1])?.name,
  })
  // Top-level pages: the page title already names the place.
  if (crumbs.length === 0) return null

  return (
    <nav aria-label="Breadcrumb" className="min-w-0 flex-1 text-sm">
      <ol className="flex min-w-0 items-center gap-1">
        {crumbs.map((crumb, index) => {
          // Phones: only the current page stays visible; the full trail would crowd
          // the header's action icons.
          const collapsible = !crumb.current
          return (
            <li
              key={crumb.path}
              // When the trail is too wide for the header, parent crumbs give way first
              // (a much higher shrink weight) so the current page keeps its title.
              className={cn(
                'flex min-w-0 items-center gap-1',
                collapsible && 'hidden shrink-[100] sm:flex',
                // Wide screens have room for the short ones ("Projects"), so only long names give way.
                collapsible && crumb.label.length <= SHORT_CRUMB && 'xl:shrink-0',
              )}
            >
              {index > 0 && (
                <ChevronRight aria-hidden="true" className="size-3.5 shrink-0 text-[var(--muted-foreground)] max-sm:hidden" />
              )}
              {crumb.current ? (
                <span title={crumb.label} aria-current="page" className="truncate font-medium text-[var(--foreground)]">
                  {crumb.label}
                </span>
              ) : crumb.link ? (
                <Link
                  to={crumb.path}
                  title={crumb.label}
                  className={cn(LINK_CLASS, 'min-w-0 max-w-[12rem]')}
                >
                  {crumb.label}
                </Link>
              ) : (
                <span title={crumb.label} className={cn(LINK_CLASS, 'min-w-0 max-w-[12rem]')}>
                  {crumb.label}
                </span>
              )}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
