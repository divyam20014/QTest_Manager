import { useQuery } from '@tanstack/react-query'
import { SlidersHorizontal } from 'lucide-react'
import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'

import { hasPermission } from '@/api/auth'
import { type ProjectLayoutWidget, type WidgetSize, getProjectLayout } from '@/api/projectDashboard'
import { getProject } from '@/api/projects'
import { Button, buttonVariants } from '@/components/ui/button'
import { EmptyState, ErrorState } from '@/components/ui/empty-state'
import { DetailSkeleton, Skeleton } from '@/components/ui/skeleton'
import { useAuth } from '@/lib/auth'
import { DEFAULT_LAYOUT } from '@/lib/projectDashboard'

import { CustomisePanel } from './overview/CustomisePanel'
import { PROJECT_WIDGETS } from './overview/widgets'

// ADR-102 / ADR-122 / ADR-123: the Overview tab is this project's configurable dashboard. It shows
// only this project's data (the project id comes from the URL and goes on every request; the API
// checks it against what the viewer may open). Widgets keep fixed S / M / L sizes; people choose
// which show and in what order (Customise), and project editors can set the project default.
// The organisation dashboard at / (all projects) is a separate page.
const SPAN: Record<WidgetSize, string> = {
  S: 'md:col-span-1 lg:col-span-1',
  M: 'md:col-span-2 lg:col-span-2',
  L: 'md:col-span-2 lg:col-span-3',
}

export function ProjectDashboard() {
  const { projectId = '' } = useParams<{ projectId: string }>()
  const { user } = useAuth()
  const [customising, setCustomising] = useState(false)
  const projectQuery = useQuery({
    queryKey: ['projects', projectId],
    queryFn: () => getProject(projectId),
  })
  const userId = user?.user_id ?? 'anon'
  const layoutQuery = useQuery({
    queryKey: ['projects', projectId, 'dashboard-layout', userId],
    queryFn: () => getProjectLayout(projectId),
    enabled: projectQuery.isSuccess,
    staleTime: 30_000,
  })

  const project = projectQuery.data
  if (projectQuery.isLoading) return <DetailSkeleton />
  if (projectQuery.isError)
    return (
      <ErrorState
        message="Could not load this project."
        error={projectQuery.error}
        onRetry={() => projectQuery.refetch()}
      />
    )
  if (!project)
    return (
      <EmptyState title="Project not found" description="It may have been deleted, or you may not have access to it." />
    )

  // If only the layout request fails the numbers still matter, so fall back to the built-in order.
  const widgets: ProjectLayoutWidget[] | undefined = layoutQuery.data?.widgets ?? (layoutQuery.isError ? DEFAULT_LAYOUT : undefined)
  const layout = layoutQuery.data

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2" data-testid="project-quick-actions">
        <p className="text-sm text-[var(--muted-foreground)]" data-testid="overview-scope">
          Showing <span className="font-medium text-[var(--foreground)]">{project.name}</span> only.{' '}
          <Link to="/" className="font-medium text-[var(--link)] hover:underline">
            See all projects
          </Link>
        </p>
        <div className="flex flex-wrap items-center justify-end gap-2 max-md:w-full">
          {hasPermission(user, 'defect.create') && (
            <Link to={`/defects/new?projectId=${project.id}`} className={buttonVariants({ variant: 'outline' })}>
              Report defect
            </Link>
          )}
          {hasPermission(user, 'testcase.create') && (
            <Link to={`/projects/${project.id}/test-cases?quick=1`} className={buttonVariants({ variant: 'outline' })}>
              New test case
            </Link>
          )}
          <Button
            type="button"
            variant="outline"
            disabled={!layout}
            onClick={() => setCustomising(true)}
            aria-haspopup="dialog"
          >
            <SlidersHorizontal className="size-4" aria-hidden="true" />
            Customise
          </Button>
          {hasPermission(user, 'testrun.create') && (
            <Link to={`/projects/${project.id}/test-runs`} className={buttonVariants()}>
              New test run
            </Link>
          )}
        </div>
      </div>

      {widgets === undefined ? (
        <div role="status" className="grid grid-cols-1 gap-3 lg:grid-cols-3">
          <span className="sr-only">Loading the dashboard</span>
          <Skeleton className="h-20 w-full lg:col-span-3" />
          <Skeleton className="h-48 w-full" />
          <Skeleton className="h-48 w-full lg:col-span-2" />
        </div>
      ) : widgets.length === 0 ? (
        <EmptyState
          title="Every widget is hidden"
          description="Use Customise to choose what this Overview shows."
          action={
            <Button size="sm" onClick={() => setCustomising(true)} disabled={!layout}>
              Customise
            </Button>
          }
        />
      ) : (
        <div
          className="grid grid-flow-row-dense grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3"
          data-testid="overview-grid"
        >
          {widgets.map((w) => {
            const render = PROJECT_WIDGETS[w.widget_type]
            if (!render) return null
            return (
              <div key={w.widget_type} className={`min-w-0 ${SPAN[w.size]}`} data-widget={w.widget_type}>
                {render({ projectId: project.id })}
              </div>
            )
          })}
        </div>
      )}

      {customising && layout && (
        <CustomisePanel projectId={project.id} layout={layout} onClose={() => setCustomising(false)} />
      )}
    </div>
  )
}
