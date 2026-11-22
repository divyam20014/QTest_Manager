import { useQuery } from '@tanstack/react-query'
import { Link, useParams } from 'react-router-dom'

import { hasPermission } from '@/api/auth'
import { buttonVariants } from '@/components/ui/button'
import { useAuth } from '@/lib/auth'

import type { DashboardWidget, WidgetType } from '@/api/dashboards'
import { getProject } from '@/api/projects'
import { listReleases } from '@/api/testAssets'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { PageHeader } from '@/components/ui/PageHeader'
import { DetailSkeleton } from '@/components/ui/skeleton'
import { EmptyState, ErrorState } from '@/components/ui/empty-state'
import { WidgetView } from '@/routes/dashboards/Widgets'
import { ProjectTabs } from './ProjectTabs'
import { PRIORITY_TONE, STATUS_TONE } from './statusDisplay'

// ADR-102: a fixed, read-only dashboard built from the ADR-099 widget
// components with this project's id preset. No customization, no new API.
const SECTIONS: {
  title: string
  widgets: { type: WidgetType; size: DashboardWidget['size'] }[]
}[] = [
  {
    title: 'Health',
    widgets: [
      { type: 'kpi_summary', size: 'L' },
      { type: 'release_readiness', size: 'M' },
      { type: 'status_distribution', size: 'S' },
    ],
  },
  {
    title: 'Trends',
    widgets: [
      { type: 'execution_trend', size: 'M' },
      { type: 'defect_leakage', size: 'S' },
    ],
  },
  {
    title: 'Risk & activity',
    widgets: [
      { type: 'open_defects_by_severity', size: 'S' },
      { type: 'defect_aging', size: 'S' },
      { type: 'flaky_tests', size: 'S' },
      { type: 'recent_activity', size: 'L' },
    ],
  },
]

const SPAN = { S: 'lg:col-span-1', M: 'lg:col-span-2', L: 'lg:col-span-3' }

export function ProjectDashboard() {
  const { projectId = '' } = useParams<{ projectId: string }>()
  const { user } = useAuth()
  const projectQuery = useQuery({
    queryKey: ['projects', projectId],
    queryFn: () => getProject(projectId),
  })
  const releasesQuery = useQuery({
    queryKey: ['releases', projectId],
    queryFn: () => listReleases(projectId),
    enabled: projectQuery.isSuccess,
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

  // Latest release of the project (by creation time); the widget falls back to
  // "whole project" when there is none.
  const latest = [...(releasesQuery.data ?? [])].sort((a, b) => b.created_at.localeCompare(a.created_at))[0]

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={project.name}
        meta={
          <>
            <StatusBadge tone={STATUS_TONE[project.status]}>{project.status}</StatusBadge>
            <StatusBadge tone={PRIORITY_TONE[project.priority]}>{project.priority}</StatusBadge>
            <StatusBadge tone="info">{project.domain}</StatusBadge>
          </>
        }
        actions={
          <>
            {hasPermission(user, 'defect.create') && (
              <Link
                to={`/defects?projectId=${project.id}&action=create`}
                className={buttonVariants({ variant: 'outline' })}
              >
                Report defect
              </Link>
            )}
            {hasPermission(user, 'testcase.create') && (
              <Link to={`/projects/${project.id}/test-cases?quick=1`} className={buttonVariants({ variant: 'outline' })}>
                New test case
              </Link>
            )}
            {hasPermission(user, 'testrun.create') && (
              <Link to={`/projects/${project.id}/test-runs`} className={buttonVariants()}>
                New test run
              </Link>
            )}
          </>
        }
      />
      <ProjectTabs projectId={project.id} />
      {SECTIONS.map((section) => (
        <section key={section.title} aria-labelledby={`pd-${section.title.charAt(0)}`} className="flex flex-col gap-3">
          <h2 id={`pd-${section.title.charAt(0)}`} className="text-lg font-semibold">
            {section.title}
          </h2>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            {section.widgets.map((w, i) => {
              const settings: DashboardWidget['settings'] = {
                project_id: project.id,
              }
              if (w.type === 'execution_trend') settings.days = 30
              if (w.type === 'flaky_tests') settings.top_n = 10
              if (w.type === 'release_readiness' && latest) settings.release_id = latest.id
              return (
                <div key={w.type} className={`min-w-0 ${SPAN[w.size]}`}>
                  <WidgetView
                    widget={{
                      id: `${project.id}-${w.type}`,
                      widget_type: w.type,
                      size: w.size,
                      position: i,
                      settings,
                      project_access: 'ok',
                    }}
                  />
                </div>
              )
            })}
          </div>
        </section>
      ))}
    </div>
  )
}
