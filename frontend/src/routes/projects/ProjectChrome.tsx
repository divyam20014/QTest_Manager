import { useQuery } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { Link, Outlet, useLocation, useParams, useSearchParams } from 'react-router-dom'

import { getProject } from '@/api/projects'
import { EmptyState, ErrorState } from '@/components/ui/empty-state'
import { useAuth } from '@/lib/auth'
import { isIdSegment } from '@/lib/breadcrumbs'
import { useWorkspaceConfig, effectiveNavConfig } from '@/lib/workspaceConfig'
import { activeTabKey, canEditProject, hiddenTabs, projectSettingsPath, resolveProjectTabs, tabAllowed, tabDef } from '@/lib/projectNav'

import { ProjectHeader } from './ProjectHeader'
import { ProjectNav } from './ProjectNav'

/**
 * Header, tab strip and (when the tab is hidden) a notice around a project page (ADR-122).
 * Used by ProjectLayout for every /projects/:id/... route and by ProjectScoped for the two tabs
 * whose pages live at /defects and /reporting. The project is read with the same query key the
 * pages use, so it is fetched once.
 *
 * Hidden tabs are a presentation choice, not access control: a direct link still opens the page
 * (the API decides who may see the data). The chrome says so instead of pretending it is gone.
 */
export function ProjectChrome({ projectId, children }: { projectId: string; children: ReactNode }) {
  const { user } = useAuth()
  const { config: workspace } = useWorkspaceConfig()
  const location = useLocation()
  const projectQuery = useQuery({
    queryKey: ['projects', projectId],
    queryFn: () => getProject(projectId),
    staleTime: 30_000,
  })
  const project = projectQuery.data

  if (projectQuery.isError) {
    return (
      <ErrorState
        message="Could not load this project."
        error={projectQuery.error}
        onRetry={() => projectQuery.refetch()}
      />
    )
  }

  const tabKey = activeTabKey(location.pathname, location.search)
  const navConfig = effectiveNavConfig(project?.nav_config, workspace)
  const tabs = resolveProjectTabs(projectId, navConfig, user)
  const hiddenHere = tabKey !== null && tabAllowed(tabKey, user) && hiddenTabs(navConfig).has(tabKey)
  const canEdit = canEditProject(user)
  const asHeading = tabKey === 'overview' && /^\/projects\/[^/]+\/?$/.test(location.pathname)

  return (
    <div className="flex flex-col gap-3 md:gap-4">
      <ProjectHeader project={project} tabKey={tabKey} asHeading={asHeading} canOpenSettings={canEdit} />
      <ProjectNav
        tabs={tabs}
        activeKey={tabKey}
        counts={
          project
            ? {
                'test-cases': { value: project.test_case_count },
                'test-runs': { value: project.test_run_count },
                defects: { value: project.open_defect_count },
              }
            : {}
        }
      />
      {hiddenHere && tabKey && (
        <p
          role="note"
          data-testid="hidden-tab-notice"
          className="rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--muted)] px-3 py-2 text-sm"
        >
          The {tabDef(tabKey)?.label} tab is hidden from this project&apos;s navigation. You can still open it from
          this link.
          {canEdit && (
            <>
              {' '}
              <Link className="font-medium underline" to={projectSettingsPath(projectId)}>
                Show it in project settings
              </Link>
              .
            </>
          )}
        </p>
      )}
      <div className="min-w-0">{children}</div>
    </div>
  )
}

/** Layout route around every /projects/:projectId/... page. */
export function ProjectLayout() {
  const { projectId = '' } = useParams<{ projectId: string }>()
  if (!projectId) return <EmptyState title="Project not found" description="The link has no project in it." />
  return (
    <ProjectChrome projectId={projectId}>
      <Outlet />
    </ProjectChrome>
  )
}

/**
 * Wraps a page that is not under /projects/:id (Defects, Reports): when the URL names a project
 * (`?projectId=` / `?project=`) the project header and tabs are shown above it, otherwise the page
 * renders exactly as before.
 */
export function ProjectScoped({ param, children }: { param: 'projectId' | 'project'; children: ReactNode }) {
  const [params] = useSearchParams()
  const id = params.get(param) ?? ''
  if (!id || !isIdSegment(id)) return <>{children}</>
  return <ProjectChrome projectId={id}>{children}</ProjectChrome>
}
